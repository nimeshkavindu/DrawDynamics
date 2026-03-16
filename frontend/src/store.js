import { create } from 'zustand';

const usePhysicsStore = create((set) => ({
  isRunning: true, 
  gravity: 9.81,
  friction: 0.1,
  entities: [], 
  status: "Connecting...",
  equations: [],
  
  // Object Selection & Editing State
  selectedId: null,
  setSelectedId: (id) => set({ selectedId: id }),
  applyBodyChange: null,
  setApplyBodyChange: (fn) => set({ applyBodyChange: fn }),

  // NEW: Proactive AI Alert System
  systemAlert: null,
  setSystemAlert: (msg) => set({ systemAlert: msg }),

  setGravity: (val) => set({ gravity: val }),
  setFriction: (val) => set({ friction: val }),
  resetEnvironment: () => set({ gravity: 9.81, friction: 0.1 }),
  setStatus: (newStatus) => set({ status: newStatus }),
  addEquation: (eq) => set((state) => ({ equations: [...state.equations, eq] })),
  clearMath: () => set({ equations: [] }),
  toggleSimulation: () => set((state) => ({ isRunning: !state.isRunning })),
  setIsRunning: (val) => set({ isRunning: val }),
  
  getEngineSnapshot: null,
  setEngineSnapshot: (fn) => set({ getEngineSnapshot: fn }),
  
  addEntity: (entity) => set((state) => ({ entities: [...state.entities, entity] })),
  clearBoard: () => set({ entities: [], equations: [], selectedId: null }) 
}));

export default usePhysicsStore;