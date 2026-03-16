import asyncio
import json
import base64
import re
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types

app = FastAPI()
client = genai.Client()

SPEAKER_INSTRUCTION = """
You are DrawDynamics PRO, an interactive physics simulation AI.
Listen to the user's problem. Break down the conceptual physics, identify the required formulas, and state the final numerical answer clearly.
CRITICAL BEHAVIOR: DO NOT output any internal thoughts or markdown formatting. Speak ONLY the exact words you want the user to hear aloud.
"""

ARCHITECT_INSTRUCTION = """
You are the Architect for a Matter.js 2D physics sandbox.
You receive a conversation history. You must output a JSON array of actions to set up the physics world based on the user's request.
SUPPORTED ACTIONS:
- SPAWN RECTANGLE: {"action": "SPAWN", "type": "rectangle", "x": 500, "y": 100, "width": 60, "height": 60, "mass": 10.0, "restitution": 0.8, "friction": 0.1, "angle": 0.0, "initialVelocity": {"x": 10.0, "y": 0.0}, "isStatic": false, "color": "#00f2ff"}
- SPAWN CIRCLE: {"action": "SPAWN", "type": "circle", "x": 500, "y": 100, "radius": 30, "mass": 5.0, "restitution": 0.9, "friction": 0.1, "angle": 0.0, "initialVelocity": {"x": 10.0, "y": 0.0}, "isStatic": false, "color": "#ff0055"}
- SPAWN PENDULUM: {"action": "SPAWN", "type": "pendulum", "x": 500, "y": 100, "length": 300, "bobRadius": 25, "mass": 5.0, "angle": 0.785, "color": "#eaff00"}
- SPAWN SPRING: {"action": "SPAWN", "type": "spring", "x": 500, "y": 700, "width": 120, "length": 150, "stiffness": 0.02, "mass": 2.0}
- SPAWN MOTOR: {"action": "SPAWN", "type": "motor", "x": 500, "y": 400, "length": 200, "speed": 0.05, "color": "#ff8800"}
- SPAWN PULLEY: {"action": "SPAWN", "type": "pulley", "x": 500, "y": 100, "length": 300, "mass": 10.0, "speed": 1.0, "color": "#aa00ff"}
RULES: ONLY output the JSON array. Strictly on one continuous line.
"""

MATHEMATICIAN_INSTRUCTION = """
You are the Mathematician for a physics app. Extract formulas and format into JSON.
SUPPORTED ACTION:
- EQUATION: {"action": "EQUATION", "math": "F = m \\cdot a", "description": "Newton's Second Law"}
RULES: ONLY output the JSON array. Double-escape all LaTeX backslashes.
"""

async def safe_send(websocket: WebSocket, lock: asyncio.Lock, data: dict):
    try:
        async with lock: await websocket.send_text(json.dumps(data))
    except (RuntimeError, WebSocketDisconnect): pass

def clean_json(raw_text: str):
    match = re.search(r'\[.*\]', raw_text, re.DOTALL)
    if match:
        try: return json.loads(match.group(0))
        except json.JSONDecodeError: return []
    return []

async def run_architect(history_text: str, websocket: WebSocket, send_lock: asyncio.Lock):
    try:
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash", contents=history_text,
            config=types.GenerateContentConfig(system_instruction=ARCHITECT_INSTRUCTION, response_mime_type="application/json", temperature=0.1)
        )
        for inst in clean_json(response.text): await safe_send(websocket, send_lock, inst)
    except Exception as e: print(f"[ARCHITECT ERROR]: {e}")

async def run_mathematician(history_text: str, websocket: WebSocket, send_lock: asyncio.Lock):
    try:
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash", contents=history_text,
            config=types.GenerateContentConfig(system_instruction=MATHEMATICIAN_INSTRUCTION, response_mime_type="application/json", temperature=0.1)
        )
        for inst in clean_json(response.text): await safe_send(websocket, send_lock, inst)
    except Exception as e: print(f"[MATH ERROR]: {e}")

async def process_turn(history_text: str, websocket: WebSocket, send_lock: asyncio.Lock):
    await safe_send(websocket, send_lock, {"action": "CLEAR_MATH"}) 
    await asyncio.gather(run_architect(history_text, websocket, send_lock), run_mathematician(history_text, websocket, send_lock))

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    send_lock = asyncio.Lock()
    conversation_history = [] 

    try:
        while True: 
            try:
                history_dump = "\n".join(conversation_history)
                dynamic_instruction = SPEAKER_INSTRUCTION
                if history_dump: dynamic_instruction += f"\n\nCRITICAL CONTEXT - PAST CONVERSATION:\n{history_dump}"

                live_config = {"response_modalities": ["AUDIO"], "system_instruction": dynamic_instruction}
                
                async with client.aio.live.connect(model="gemini-2.5-flash-native-audio-preview-12-2025", config=live_config) as session:
                    
                    async def client_to_gemini():
                        while True:
                            message = await websocket.receive()
                            if "bytes" in message:
                                await session.send_realtime_input(audio={"data": message["bytes"], "mime_type": "audio/pcm;rate=16000"})
                            elif "text" in message:
                                try:
                                    payload = json.loads(message["text"])
                                    
                                    if payload.get("type") == "sync_state":
                                        state_msg = f"[SYSTEM LOG - CURRENT CANVAS STATE]: {json.dumps(payload.get('data', []))}"
                                        conversation_history.append(state_msg)
                                        # THE FIX: Inject the state directly into the active Gemini session quietly!
                                        await session.send_client_content(
                                            turns=[types.Content(role="user", parts=[types.Part.from_text(text=state_msg)])], 
                                            turn_complete=False # False means "read this, but don't respond yet"
                                        )
                                        
                                    elif payload.get("type") == "system_alert":
                                        alert_text = payload.get("text")
                                        conversation_history.append(f"System: {alert_text}")
                                        await safe_send(websocket, send_lock, {"action": "STATUS", "text": "AI Observer Analyzing... 👁️"})
                                        await session.send_client_content(turns=[types.Content(role="user", parts=[types.Part.from_text(text=alert_text)])], turn_complete=True)

                                    elif payload.get("type") == "end_audio_turn":
                                        await safe_send(websocket, send_lock, {"action": "STATUS", "text": "Analyzing Simulation... 🧠"})
                                        await session.send_client_content(turns=[types.Content(role="user", parts=[types.Part.from_text(text=" ")])], turn_complete=True)
                                        conversation_history.append("User: [Spoke via Microphone]")
                                        
                                    elif payload.get("type") == "chat":
                                        await safe_send(websocket, send_lock, {"action": "STATUS", "text": "Analyzing... 🧠"})
                                        parts = []
                                        if payload.get("text"): 
                                            parts.append(types.Part.from_text(text=payload["text"]))
                                            conversation_history.append(f"User: {payload['text']}")
                                        if parts: await session.send_client_content(turns=[types.Content(role="user", parts=parts)], turn_complete=True)
                                except Exception: pass

                    async def gemini_to_client():
                        full_transcript = ""
                        audio_chunks = [] 
                        
                        async for response in session.receive():
                            server_content = response.server_content
                            if server_content is not None:
                                if server_content.model_turn:
                                    for part in server_content.model_turn.parts:
                                        if part.text: full_transcript += part.text
                                        if part.inline_data and isinstance(part.inline_data.data, bytes):
                                            audio_chunks.append(part.inline_data.data)
                                
                                if server_content.turn_complete and full_transcript.strip():
                                    await safe_send(websocket, send_lock, {"action": "STATUS", "text": "Generating Environment... ⚙️"})
                                    conversation_history.append(f"Tutor: {full_transcript}")
                                    full_context = "\n\n".join(conversation_history)
                                    
                                    await process_turn(full_context, websocket, send_lock)
                                    
                                    await safe_send(websocket, send_lock, {"action": "STATUS", "text": "Speaking... 🔊"})
                                    for chunk in audio_chunks:
                                        try:
                                            async with send_lock: await websocket.send_bytes(chunk)
                                            await asyncio.sleep(0.01) 
                                        except: break
                                    
                                    full_transcript = ""
                                    audio_chunks = []
                                    await safe_send(websocket, send_lock, {"action": "STATUS", "text": "System Ready"})
                    
                    client_task = asyncio.create_task(client_to_gemini())
                    gemini_task = asyncio.create_task(gemini_to_client())
                    done, pending = await asyncio.wait([client_task, gemini_task], return_when=asyncio.FIRST_COMPLETED)
                    for task in pending: task.cancel()
                    for task in done:
                        if task.exception(): raise task.exception()

            except WebSocketDisconnect: break 
            except RuntimeError as e:
                if "disconnect" in str(e).lower() or "receive" in str(e).lower(): break
                await asyncio.sleep(1)
            except Exception as e: await asyncio.sleep(1) 
                
    finally:
        try: await websocket.close()
        except: pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")