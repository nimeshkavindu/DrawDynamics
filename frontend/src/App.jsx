import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Trash2, Box, Mic, MicOff, Send, Paperclip, RotateCcw, Settings, ArrowUpToLine, Zap, Target, Magnet } from 'lucide-react';
import 'katex/dist/katex.min.css';
import { BlockMath } from 'react-katex';
import PhysicsEngine from './PhysicsEngine';
import usePhysicsStore from './store';

export default function App() {
  const { 
    isRunning, toggleSimulation, addEntity, clearBoard, entities, 
    status, setStatus, equations, addEquation, clearMath,
    gravity, friction, setGravity, setFriction, resetEnvironment,
    setIsRunning, getEngineSnapshot, selectedId, applyBodyChange,
    systemAlert, setSystemAlert 
  } = usePhysicsStore();
  
  const [isRecording, setIsRecording] = useState(false);
  const [inputText, setInputText] = useState("");
  const [selectedData, setSelectedData] = useState(null); 
  const [activeTab, setActiveTab] = useState('inspector'); 

  const wsRef = useRef(null);
  const nextAudioTimeRef = useRef(0);
  const audioContextRef = useRef(null); 
  const recordingContextRef = useRef(null); 
  const streamRef = useRef(null);
  const processorRef = useRef(null);

  useEffect(() => {
    const interval = setInterval(() => {
        if (selectedId && getEngineSnapshot) {
            const snapshot = getEngineSnapshot();
            const data = snapshot.find(s => s.reactId === selectedId);
            setSelectedData(data);
        } else setSelectedData(null);
    }, 100); 
    return () => clearInterval(interval);
  }, [selectedId, getEngineSnapshot]);

  useEffect(() => {
    let reconnectTimer;
    const connectWebSocket = () => {
      setStatus("Connecting to AI Core...");
      const websocket = new WebSocket("ws://127.0.0.1:8000/ws");
      websocket.binaryType = "arraybuffer";
      wsRef.current = websocket;
      websocket.onopen = () => setStatus("System Ready");

      websocket.onmessage = async (event) => {
        if (typeof event.data === "string") {
          try {
            const data = JSON.parse(event.data);
            if (data.action === "EQUATION") {
                addEquation({ id: Date.now() + Math.random(), math: data.math, description: data.description });
                setActiveTab('equations'); 
            }
            else if (data.action === "CLEAR_MATH") { clearMath(); setIsRunning(false); }
            else if (data.action === "STATUS") setStatus(data.text);
            else if (data.action === "SPAWN") addEntity({ id: Date.now() + Math.random(), ...data });
          } catch (e) { console.error("Invalid JSON", e); }
        } else {
          if (!audioContextRef.current) return;
          const audioContext = audioContextRef.current;
          const int16Data = new Int16Array(event.data);
          const float32Data = new Float32Array(int16Data.length);
          for (let i = 0; i < int16Data.length; i++) float32Data[i] = int16Data[i] / 32768.0;

          const audioBuffer = audioContext.createBuffer(1, float32Data.length, 24000);
          audioBuffer.getChannelData(0).set(float32Data);
          const source = audioContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioContext.destination);
          
          let startTime = Math.max(audioContext.currentTime, nextAudioTimeRef.current);
          source.start(startTime);
          nextAudioTimeRef.current = startTime + audioBuffer.duration;
        }
      };
      websocket.onclose = () => {
        setStatus("Connection Lost. Reconnecting...");
        reconnectTimer = setTimeout(connectWebSocket, 2000);
      };
    };
    connectWebSocket();
    return () => { clearTimeout(reconnectTimer); if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); } };
  }, [addEquation, clearMath, setIsRunning, setStatus, addEntity]);

  useEffect(() => {
      if (systemAlert && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          if (getEngineSnapshot) wsRef.current.send(JSON.stringify({ type: "sync_state", data: getEngineSnapshot() }));
          wsRef.current.send(JSON.stringify({ type: "system_alert", text: systemAlert }));
          setSystemAlert(null); 
      }
  }, [systemAlert, getEngineSnapshot, setSystemAlert]);

  const handleToggleSimulation = async () => {
    if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
    toggleSimulation();
  };

  const handleAnalyzeSimulation = async () => {
    if (isRunning) setIsRunning(false);
    if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const stateSnapshot = getEngineSnapshot ? getEngineSnapshot() : [];
      const analysisPrompt = `[System Data: ${JSON.stringify(stateSnapshot)}] \n\nPlease analyze this exact simulation state. Look at the objects, their masses, velocities, constraints, and positions. Predict exactly what will happen when the engine unpauses. Explain the physics involved. DO NOT ask me for any missing parameters, read them directly from the JSON array provided above.`;
      wsRef.current.send(JSON.stringify({ type: "chat", text: analysisPrompt }));
    }
  };

  const sendMessage = async () => {
    if (!inputText.trim()) return;
    if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      if (getEngineSnapshot) wsRef.current.send(JSON.stringify({ type: "sync_state", data: getEngineSnapshot() }));
      wsRef.current.send(JSON.stringify({ type: "chat", text: inputText }));
    }
    setInputText("");
  };

  const startMic = async () => { 
    try {
        setIsRecording(true);
        setStatus("Microphone Active...");
        nextAudioTimeRef.current = 0; 
        if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
        recordingContextRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        if (recordingContextRef.current.state === 'suspended') await recordingContextRef.current.resume();
  
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true } });
        streamRef.current = stream;
        const source = recordingContextRef.current.createMediaStreamSource(stream);
        processorRef.current = recordingContextRef.current.createScriptProcessor(4096, 1, 1);
        
        processorRef.current.onaudioprocess = (e) => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            const float32Array = e.inputBuffer.getChannelData(0);
            const int16Array = new Int16Array(float32Array.length);
            for (let i = 0; i < float32Array.length; i++) int16Array[i] = Math.max(-1, Math.min(1, float32Array[i])) * 32767;
            wsRef.current.send(int16Array.buffer);
          }
        };
        source.connect(processorRef.current);
        processorRef.current.connect(recordingContextRef.current.destination);
      } catch (err) { setIsRecording(false); }
  };

  const stopMic = () => { 
      if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
      if (processorRef.current) processorRef.current.disconnect();
      if (recordingContextRef.current) recordingContextRef.current.close();
      setIsRecording(false);
      setStatus("Processing Audio...");
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          if (getEngineSnapshot) wsRef.current.send(JSON.stringify({ type: "sync_state", data: getEngineSnapshot() }));
          wsRef.current.send(JSON.stringify({ type: "end_audio_turn" }));
      }
  };

  const handleDropBox = () => addEntity({ id: Date.now(), type: 'rectangle', x: Math.random() * 400 + 300, y: -50, width: 60, height: 60, restitution: 0.85, color: '#00f2ff' });
  const handleDropBall = () => addEntity({ id: Date.now(), type: 'circle', x: Math.random() * 400 + 300, y: -50, radius: 30, restitution: 0.9, color: '#ff0055' });
  const handleDropPendulum = () => addEntity({ id: Date.now(), type: 'pendulum', x: 500, y: 150, length: 250, bobRadius: 25, mass: 5.0, angle: 0.785, color: '#eaff00' });
  const handleDropSpring = () => addEntity({ id: Date.now(), type: 'spring', x: 500, y: 700, width: 120, length: 150, stiffness: 0.02, mass: 2.0 });
  const handleDropMotor = () => addEntity({ id: Date.now(), type: 'motor', x: 500, y: 400, length: 200, speed: 0.05, color: '#ff8800' });
  const handleDropPulley = () => addEntity({ id: Date.now(), type: 'pulley', x: 500, y: 100, length: 300, mass: 10, speed: 1.0, color: '#aa00ff' });

  const handleResetObject = () => {
    setIsRunning(false); 
    if (!selectedId) return;
    applyBodyChange(selectedId, 'velocityX', 0); applyBodyChange(selectedId, 'velocityY', 0);
    applyBodyChange(selectedId, 'restitution', 0.8); applyBodyChange(selectedId, 'friction', friction); applyBodyChange(selectedId, 'mass', 5); 
  };

  // ==========================================
  // NEW: HACKATHON DEMO PRESETS
  // ==========================================
  const loadPresetBattingCage = () => {
    setIsRunning(false);
    clearBoard();
    resetEnvironment();
    setTimeout(() => {
      // The Target Tower
      addEntity({ id: Date.now() + 1, type: 'rectangle', x: 800, y: 700, width: 60, height: 60, mass: 10, color: '#00f2ff' });
      addEntity({ id: Date.now() + 2, type: 'rectangle', x: 800, y: 640, width: 60, height: 60, mass: 5, color: '#00f2ff' });
      addEntity({ id: Date.now() + 3, type: 'rectangle', x: 800, y: 580, width: 60, height: 60, mass: 5, color: '#00f2ff' });
      addEntity({ id: Date.now() + 4, type: 'rectangle', x: 800, y: 520, width: 60, height: 60, mass: 5, color: '#00f2ff' });
      // The Pitching Machine
      addEntity({ id: Date.now() + 5, type: 'motor', x: 200, y: 650, length: 250, speed: 0.15, color: '#ff8800' });
      addEntity({ id: Date.now() + 6, type: 'circle', x: 100, y: 200, radius: 25, mass: 20, restitution: 0.5, color: '#ff0055' });
    }, 100);
  };

  const loadPresetCentrifuge = () => {
    setIsRunning(false);
    clearBoard();
    setGravity(0); // Zero gravity for max chaos!
    setTimeout(() => {
      addEntity({ id: Date.now() + 1, type: 'motor', x: 500, y: 400, length: 300, speed: 0.2, color: '#ff8800' });
      // Flubber balls with > 1.0 bounciness
      addEntity({ id: Date.now() + 2, type: 'circle', x: 400, y: 300, radius: 20, mass: 2, restitution: 1.05, color: '#ff0055' });
      addEntity({ id: Date.now() + 3, type: 'circle', x: 600, y: 500, radius: 20, mass: 2, restitution: 1.05, color: '#eaff00' });
      addEntity({ id: Date.now() + 4, type: 'circle', x: 600, y: 300, radius: 20, mass: 2, restitution: 1.05, color: '#00f2ff' });
    }, 100);
  };

  const loadPresetElevatorTrap = () => {
    setIsRunning(false);
    clearBoard();
    resetEnvironment();
    setTimeout(() => {
      addEntity({ id: Date.now() + 1, type: 'pulley', x: 500, y: 100, length: 500, mass: 50000, speed: 1.5, color: '#aa00ff' });
      addEntity({ id: Date.now() + 2, type: 'circle', x: 500, y: 50, radius: 40, mass: 50, restitution: 0.2, color: '#ff0055' });
    }, 100);
  };

  return (
    <div className="fixed inset-0 flex flex-col w-full h-full bg-background-dark text-slate-100 overflow-hidden font-display">
      <header className="flex items-center justify-between border-b border-white/10 bg-sidebar-dark px-6 py-3 shrink-0 relative z-20">
        <div className="flex items-center gap-3 w-1/4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/20 text-primary neon-glow"><span className="material-symbols-outlined">deployed_code</span></div>
          <h2 className="text-xl font-bold tracking-tight text-white hidden sm:block">DrawDynamics <span className="text-xs font-mono text-primary/80 ml-1">v2.0_PRO</span></h2>
        </div>
        
        <div className="flex-1 flex justify-center w-2/4">
          <div className="w-full max-w-2xl bg-background border border-white/10 px-2 py-1.5 rounded-xl shadow-lg flex items-center gap-2">
            <button onClick={isRecording ? stopMic : startMic} className={`p-2 rounded-lg transition-colors ${isRecording ? 'bg-red-500 animate-pulse text-white' : 'bg-white/5 text-primary hover:bg-white/10'}`}>
              {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            <div className="flex-1 bg-black/40 border border-white/5 rounded-lg px-3 py-1.5 flex items-center gap-2 focus-within:border-primary/50 transition-colors">
              <Paperclip size={16} className="text-slate-500 cursor-pointer hover:text-white" />
              <input 
                type="text" placeholder="Ask the AI to spawn an object or predict an outcome..." 
                className="flex-1 bg-transparent border-none text-white text-sm focus:ring-0 placeholder:text-slate-500 px-2 outline-none w-full"
                value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              />
            </div>
            <button onClick={sendMessage} className="p-2 bg-primary text-background-dark rounded-lg hover:opacity-90 transition-opacity"><Send size={18} /></button>
          </div>
        </div>
        
        <div className="w-1/4 flex justify-end">
          {status.includes("Speaking") && (
            <div className="flex items-center gap-3 bg-primary/10 px-4 py-1.5 rounded-full border border-primary/30 shadow-[0_0_15px_rgba(0,242,255,0.2)]">
              <span className="text-[10px] font-bold text-primary tracking-widest uppercase animate-pulse">Luminate AI Active</span>
              <div className="flex items-end gap-1 h-3">
                <div className="w-1 bg-primary rounded-full animate-bounce h-full" style={{ animationDelay: '0ms' }}></div>
                <div className="w-1 bg-primary rounded-full animate-bounce h-2/3" style={{ animationDelay: '150ms' }}></div>
                <div className="w-1 bg-primary rounded-full animate-bounce h-4/5" style={{ animationDelay: '300ms' }}></div>
                <div className="w-1 bg-primary rounded-full animate-bounce h-1/2" style={{ animationDelay: '450ms' }}></div>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative z-10">
        <aside className="w-64 flex flex-col border-r border-white/10 bg-sidebar-dark p-4 gap-4 shrink-0 relative z-20 overflow-y-auto">
          <div className="space-y-3">
            <p className="px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Toolkit</p>
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg text-slate-400 hover:bg-white/5 cursor-pointer">
              <span className="material-symbols-outlined text-lg">near_me</span><span className="text-sm font-medium">Select / Drag</span>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <div onClick={handleDropBox} className="flex flex-col items-center gap-1 p-3 rounded-lg bg-white/5 text-slate-300 hover:bg-primary/20 hover:text-primary border border-transparent cursor-pointer transition-all"><span className="material-symbols-outlined text-xl">square</span><span className="text-[10px] font-bold uppercase tracking-wider">Box</span></div>
              <div onClick={handleDropBall} className="flex flex-col items-center gap-1 p-3 rounded-lg bg-white/5 text-slate-300 hover:bg-[#ff0055]/20 hover:text-[#ff0055] border border-transparent cursor-pointer transition-all"><span className="material-symbols-outlined text-xl">circle</span><span className="text-[10px] font-bold uppercase tracking-wider">Ball</span></div>
              <div onClick={handleDropPendulum} className="flex flex-col items-center gap-1 p-3 rounded-lg bg-white/5 text-slate-300 hover:bg-[#eaff00]/20 hover:text-[#eaff00] border border-transparent cursor-pointer transition-all"><span className="material-symbols-outlined text-xl">vibration</span><span className="text-[10px] font-bold uppercase tracking-wider">Pendulum</span></div>
              <div onClick={handleDropSpring} className="flex flex-col items-center gap-1 p-3 rounded-lg bg-white/5 text-slate-300 hover:bg-primary/20 hover:text-primary border border-transparent cursor-pointer transition-all"><span className="material-symbols-outlined text-xl">compress</span><span className="text-[10px] font-bold uppercase tracking-wider">Spring</span></div>
              <div onClick={handleDropMotor} className="flex flex-col items-center gap-1 p-3 rounded-lg bg-white/5 text-slate-300 hover:bg-[#ff8800]/20 hover:text-[#ff8800] border border-transparent cursor-pointer transition-all"><Settings size={20} /><span className="text-[10px] font-bold uppercase tracking-wider">Motor</span></div>
              <div onClick={handleDropPulley} className="flex flex-col items-center gap-1 p-3 rounded-lg bg-white/5 text-slate-300 hover:bg-[#aa00ff]/20 hover:text-[#aa00ff] border border-transparent cursor-pointer transition-all"><ArrowUpToLine size={20} /><span className="text-[10px] font-bold uppercase tracking-wider">Elevator</span></div>
            </div>
          </div>

          {/* NEW: DEMO SCENES FOR HACKATHON PITCH */}
          <div className="space-y-2 mt-2 pt-4 border-t border-white/10">
            <p className="px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">Demo Scenes</p>
            <button onClick={loadPresetBattingCage} className="w-full py-2 px-3 flex items-center gap-3 bg-white/5 hover:bg-primary/20 text-slate-300 hover:text-primary rounded-lg transition-colors border border-transparent hover:border-primary/30 text-xs font-bold">
              <Target size={14} /> Batting Cage
            </button>
            <button onClick={loadPresetCentrifuge} className="w-full py-2 px-3 flex items-center gap-3 bg-white/5 hover:bg-[#eaff00]/20 text-slate-300 hover:text-[#eaff00] rounded-lg transition-colors border border-transparent hover:border-[#eaff00]/30 text-xs font-bold">
              <Zap size={14} /> Chaos Centrifuge
            </button>
            <button onClick={loadPresetElevatorTrap} className="w-full py-2 px-3 flex items-center gap-3 bg-white/5 hover:bg-[#aa00ff]/20 text-slate-300 hover:text-[#aa00ff] rounded-lg transition-colors border border-transparent hover:border-[#aa00ff]/30 text-xs font-bold">
              <Magnet size={14} /> Elevator Trap
            </button>
          </div>

          <div className="mt-auto space-y-4 pt-4">
            <div className="glass p-4 rounded-xl space-y-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Environment</span>
                <button onClick={resetEnvironment} className="text-slate-500 hover:text-primary transition-colors"><RotateCcw size={14} /></button>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2"><span className="text-xs font-medium text-slate-300">Gravity</span><span className="text-xs font-mono text-primary">{gravity.toFixed(2)} m/s²</span></div>
                <input type="range" min="0" max="25" step="0.1" value={gravity} onChange={(e) => setGravity(parseFloat(e.target.value))} className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-primary" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2"><span className="text-xs font-medium text-slate-300">Global Friction</span><span className="text-xs font-mono text-primary">{friction.toFixed(2)}</span></div>
                <input type="range" min="0" max="1" step="0.05" value={friction} onChange={(e) => setFriction(parseFloat(e.target.value))} className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-primary" />
              </div>
            </div>
            
            <div className="flex flex-col gap-2">
                <button onClick={handleToggleSimulation} className={`w-full py-2.5 font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2 ${isRunning ? 'bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30' : 'bg-primary text-background-dark neon-glow hover:bg-primary/90'}`}>
                <span className="material-symbols-outlined text-lg">{isRunning ? 'pause' : 'play_arrow'}</span>{isRunning ? 'Pause Engine' : 'Run Simulation'}
                </button>
                
                <button onClick={handleAnalyzeSimulation} className="w-full py-2.5 font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2 bg-[#aa00ff]/20 text-[#d05ce3] border border-[#aa00ff]/50 hover:bg-[#aa00ff]/30">
                <span className="material-symbols-outlined text-lg">psychology</span>Analyze Simulation
                </button>
            </div>
          </div>
        </aside>

        <main className="relative flex-1 bg-canvas-dark dot-grid overflow-hidden">
          <PhysicsEngine />

          <div className="absolute top-6 right-6 bottom-6 w-80 glass rounded-2xl flex flex-col p-4 z-10 shadow-2xl pointer-events-auto">
            <div className="flex bg-black/40 border border-white/5 rounded-lg p-1 mb-4 shrink-0">
              <button onClick={() => setActiveTab('inspector')} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'inspector' ? 'bg-primary text-background-dark shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>Inspector</button>
              <button onClick={() => setActiveTab('equations')} className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'equations' ? 'bg-primary text-background-dark shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>Math Log</button>
            </div>
            
            {activeTab === 'inspector' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                {selectedData ? (
                  <div className="space-y-6 overflow-y-auto pr-2 pb-4 flex-1">
                    <div className="space-y-3">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Kinematics</label>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-white/5 p-2 rounded-lg border border-white/5">
                          <p className="text-[10px] text-slate-500 mb-1">Velocity (x)</p>
                          <input 
                            type="number" step="1" key={`vx-${selectedId}`} defaultValue={selectedData.velocityX} 
                            onFocus={() => setIsRunning(false)} 
                            onBlur={(e) => applyBodyChange(selectedId, 'velocityX', parseFloat(e.target.value))} 
                            onKeyDown={(e) => e.key === 'Enter' && applyBodyChange(selectedId, 'velocityX', parseFloat(e.target.value))} 
                            className="w-full bg-transparent border-b border-white/10 text-sm font-mono text-white focus:ring-0 p-0 focus:border-primary" 
                          />
                        </div>
                        <div className="bg-white/5 p-2 rounded-lg border border-white/5">
                          <p className="text-[10px] text-slate-500 mb-1">Velocity (y)</p>
                          <input 
                            type="number" step="1" key={`vy-${selectedId}`} defaultValue={selectedData.velocityY} 
                            onFocus={() => setIsRunning(false)} 
                            onBlur={(e) => applyBodyChange(selectedId, 'velocityY', parseFloat(e.target.value))} 
                            onKeyDown={(e) => e.key === 'Enter' && applyBodyChange(selectedId, 'velocityY', parseFloat(e.target.value))} 
                            className="w-full bg-transparent border-b border-white/10 text-sm font-mono text-white focus:ring-0 p-0 focus:border-primary" 
                          />
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Material Properties</label>
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                          <span className="text-xs text-slate-300">Bounciness (0-1)</span>
                          <input type="number" step="0.1" min="0" max="1" key={`rest-${selectedId}`} defaultValue={selectedData.restitution} onFocus={() => setIsRunning(false)} onChange={(e) => applyBodyChange(selectedId, 'restitution', parseFloat(e.target.value))} className="w-16 bg-transparent border-none text-right text-xs font-mono text-primary focus:ring-0 p-0" />
                        </div>
                        <div className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                          <span className="text-xs text-slate-300">Friction (0-1)</span>
                          <input type="number" step="0.1" min="0" max="1" key={`fric-${selectedId}`} defaultValue={selectedData.friction} onFocus={() => setIsRunning(false)} onChange={(e) => applyBodyChange(selectedId, 'friction', parseFloat(e.target.value))} className="w-16 bg-transparent border-none text-right text-xs font-mono text-primary focus:ring-0 p-0" />
                        </div>
                        <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10">
                          <span className="text-xs font-bold text-white">Mass (kg)</span>
                          <input type="number" step="1" key={`mass-${selectedId}`} defaultValue={selectedData.mass} onFocus={() => setIsRunning(false)} onChange={(e) => applyBodyChange(selectedId, 'mass', parseFloat(e.target.value))} className="w-20 bg-transparent border-none text-right text-sm font-bold font-mono text-primary focus:ring-0 p-0" />
                        </div>
                      </div>
                    </div>
                    <div className="pt-2">
                      <button onClick={handleResetObject} className="w-full py-2 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs font-bold rounded-lg border border-white/10 transition-colors flex items-center justify-center gap-2"><RotateCcw size={14} /> Reset Properties</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-4 opacity-50">
                    <span className="material-symbols-outlined text-4xl mb-2">touch_app</span><p className="text-sm font-medium text-white">No Object Selected</p><p className="text-xs text-slate-400 mt-1">Click on any object in the canvas to view and edit its physics properties.</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'equations' && (
              <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-3">
                {equations.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-4 opacity-50"><span className="material-symbols-outlined text-4xl mb-2">calculate</span><p className="text-sm font-medium text-white">No Math Data</p><p className="text-xs text-slate-400 mt-1">Ask the AI a physics question to generate formulas and calculations here.</p></div>
                ) : (
                  equations.map((eq) => (
                    <div key={eq.id} className="bg-white/5 border border-white/10 rounded-xl p-3">
                      {eq.description && <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-2">{eq.description}</p>}
                      <div className="text-primary overflow-x-auto"><BlockMath math={eq.math} /></div>
                    </div>
                  ))
                )}
                <div ref={equationsEndRef} />
              </div>
            )}

            <div className="pt-4 border-t border-white/10 mt-auto shrink-0">
              <button onClick={clearBoard} className="w-full py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold rounded-lg border border-red-500/20 transition-colors">Clear Simulation</button>
            </div>
          </div>
        </main>
      </div>

      <footer className="h-8 bg-sidebar-dark border-t border-white/10 px-4 flex items-center justify-between shrink-0 relative z-20">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${status === 'System Ready' ? 'bg-green-500 neon-glow' : 'bg-yellow-500 animate-pulse'}`}></div>
            <span className="text-[10px] font-mono text-slate-400 tracking-tighter">{status}</span>
          </div>
          <span className="text-[10px] font-mono text-slate-500">Entities: {entities.length}</span>
        </div>
      </footer>
    </div>
  );
}