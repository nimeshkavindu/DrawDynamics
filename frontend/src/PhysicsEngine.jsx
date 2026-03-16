import { useEffect, useRef } from 'react';
import Matter from 'matter-js';
import usePhysicsStore from './store';

export default function PhysicsEngine() {
  const sceneRef = useRef(null);
  const engineRef = useRef(null);
  const renderRef = useRef(null);
  const runnerRef = useRef(null);
  
  const { isRunning, entities, friction, setEngineSnapshot, setSelectedId, setApplyBodyChange } = usePhysicsStore();

  useEffect(() => {
    const { Engine, Render, Runner, World, Bodies, Mouse, MouseConstraint, Events, Composite } = Matter;

    const engine = Engine.create();
    engineRef.current = engine;

    const render = Render.create({
      element: sceneRef.current,
      engine: engine,
      options: {
        width: sceneRef.current.clientWidth,
        height: sceneRef.current.clientHeight,
        wireframes: false,
        background: 'transparent' 
      }
    });
    renderRef.current = render;

    const floor = Bodies.rectangle(sceneRef.current.clientWidth / 2, sceneRef.current.clientHeight + 25, sceneRef.current.clientWidth * 2, 50, { isStatic: true });
    const wallLeft = Bodies.rectangle(-25, sceneRef.current.clientHeight / 2, 50, sceneRef.current.clientHeight * 2, { isStatic: true });
    const wallRight = Bodies.rectangle(sceneRef.current.clientWidth + 25, sceneRef.current.clientHeight / 2, 50, sceneRef.current.clientHeight * 2, { isStatic: true });
    World.add(engine.world, [floor, wallLeft, wallRight]);

    const mouse = Mouse.create(render.canvas);
    const mouseConstraint = MouseConstraint.create(engine, {
      mouse: mouse,
      constraint: { stiffness: 0.2, render: { visible: false } }
    });
    World.add(engine.world, mouseConstraint);
    render.mouse = mouse;

    Render.run(render);
    const runner = Runner.create();
    runnerRef.current = runner;
    Runner.run(runner, engine);

    let draggedBody = null;
    Events.on(mouseConstraint, 'startdrag', (e) => { draggedBody = e.body; });
    Events.on(mouseConstraint, 'enddrag', (e) => { draggedBody = null; });

    Events.on(mouseConstraint, 'mousedown', () => {
        const body = mouseConstraint.body;
        if (body && body.plugin && body.plugin.reactId) {
            usePhysicsStore.getState().setSelectedId(body.plugin.reactId);
        } else {
            usePhysicsStore.getState().setSelectedId(null);
        }
    });

    Events.on(engine, 'collisionStart', (event) => {
        event.pairs.forEach((pair) => {
            const { bodyA, bodyB } = pair;
            if (bodyA.isStatic && bodyB.isStatic) return;

            const relSpeed = Math.hypot(bodyA.velocity.x - bodyB.velocity.x, bodyA.velocity.y - bodyB.velocity.y);
            if (relSpeed < 10) return; 

            const massA = bodyA.isStatic ? 50000 : bodyA.mass;
            const massB = bodyB.isStatic ? 50000 : bodyB.mass;
            const impactForce = 0.5 * Math.min(massA, massB) * relSpeed * relSpeed;

            if (impactForce > 10000) { 
                const state = usePhysicsStore.getState();
                if (!window.lastAlertTime || Date.now() - window.lastAlertTime > 8000) {
                    window.lastAlertTime = Date.now();
                    const nameA = bodyA.label !== 'Rectangle Body' ? bodyA.label : 'an object';
                    const nameB = bodyB.label !== 'Rectangle Body' ? bodyB.label : 'an object';
                    state.setSystemAlert(`[SYSTEM ALERT: MASSIVE COLLISION! A ${Math.round(massA)}kg ${nameA} just violently slammed into a ${Math.round(massB)}kg ${nameB} in the simulation! Speak up unprompted, act excited, and briefly explain the physics of what just happened to the user!]`);
                }
            }
        });
    });

    let wasRunning = true;

    Events.on(engine, 'beforeUpdate', () => {
        const state = usePhysicsStore.getState(); 
        const currentlyRunning = state.isRunning;

        engine.world.bodies.forEach(body => {
            if (body.label === 'anchor') {
                Matter.Body.setStatic(body, currentlyRunning);
            }
        });

        if (wasRunning && !currentlyRunning) {
            engine.world.bodies.forEach(body => {
                if (!body.isStatic) {
                    body.plugin.savedVelocity = { x: body.velocity.x, y: body.velocity.y };
                    body.plugin.savedAngularVelocity = body.angularVelocity;
                }
            });
        } 
        else if (!wasRunning && currentlyRunning) {
            engine.world.bodies.forEach(body => {
                if (!body.isStatic && body.plugin.savedVelocity) {
                    Matter.Body.setVelocity(body, body.plugin.savedVelocity);
                    Matter.Body.setAngularVelocity(body, body.plugin.savedAngularVelocity || 0);
                    body.plugin.savedVelocity = null;
                }
            });
        }

        if (!currentlyRunning) {
            engine.gravity.y = 0;
            engine.gravity.x = 0;
            engine.world.bodies.forEach(body => {
                if (!body.isStatic && body !== draggedBody) {
                    Matter.Body.setVelocity(body, { x: 0, y: 0 });
                    Matter.Body.setAngularVelocity(body, 0);
                }
            });
        } else {
            engine.gravity.y = state.gravity / 9.81;
        }

        engine.world.bodies.forEach(body => {
            if (body.label === 'spring_platform' && body.plugin && body.plugin.baseId) {
                const base = engine.world.bodies.find(b => b.id === body.plugin.baseId);
                if (base) {
                    Matter.Body.setPosition(body, { x: base.position.x, y: body.position.y });
                    Matter.Body.setAngle(body, 0);
                    Matter.Body.setAngularVelocity(body, 0);
                }
            }
            if (currentlyRunning && body.plugin && body.plugin.isMotor) {
                Matter.Body.setAngularVelocity(body, body.plugin.speed);
            }
        });

        if (currentlyRunning) {
            engine.world.constraints.forEach(constraint => {
                if (constraint.plugin && constraint.plugin.isWinch && constraint.length > constraint.plugin.minLength) {
                    constraint.length -= constraint.plugin.speed; 
                }
            });
        }

        wasRunning = currentlyRunning;
    });

    // ==========================================
    // NEW: TRACK PAST POSITIONS FOR TRACERS
    // ==========================================
    Events.on(engine, 'afterUpdate', () => {
        if (usePhysicsStore.getState().isRunning) {
            engine.world.bodies.forEach(body => {
                if (body.isStatic || body.label === 'anchor') return;
                
                body.plugin.trail = body.plugin.trail || [];
                
                // Only track points if moving to avoid clumped dots
                if (body.speed > 0.5) {
                    // Reset the trail if the user dragged/teleported the object across the screen
                    if (body.plugin.trail.length > 0) {
                        const lastPoint = body.plugin.trail[body.plugin.trail.length - 1];
                        const dist = Math.hypot(body.position.x - lastPoint.x, body.position.y - lastPoint.y);
                        if (dist > 50) body.plugin.trail = []; 
                    }
                    
                    // Save the current coordinate
                    body.plugin.trail.push({ x: body.position.x, y: body.position.y });
                    
                    // Keep the last 40 frames for a gorgeous long tail
                    if (body.plugin.trail.length > 40) {
                        body.plugin.trail.shift();
                    }
                } else if (body.plugin.trail.length > 0) {
                    // Gradually fade and shrink the trail when the object stops moving
                    body.plugin.trail.shift();
                }
            });
        }
    });

    // ==========================================
    // RENDER TRACERS & VELOCITY VECTORS
    // ==========================================
    Events.on(render, 'afterRender', () => {
        const ctx = render.context;
        const allBodies = Composite.allBodies(engine.world);
        const state = usePhysicsStore.getState();
        const isPaused = !state.isRunning;

        allBodies.forEach(body => {
            if (body.isStatic || body.label === 'anchor') return;

            // 1. DRAW THE FADING TRACER TAIL
            if (body.plugin.trail && body.plugin.trail.length > 1) {
                // Match the tracer color to the object's color!
                const trailColor = body.render.fillStyle || '#00f2ff';
                ctx.lineCap = 'round';
                ctx.lineWidth = 4;
                
                for (let i = 0; i < body.plugin.trail.length - 1; i++) {
                    // Older points (lower index) get lower opacity, creating a fade effect
                    ctx.globalAlpha = (i / body.plugin.trail.length) * 0.6; 
                    ctx.beginPath();
                    ctx.moveTo(body.plugin.trail[i].x, body.plugin.trail[i].y);
                    ctx.lineTo(body.plugin.trail[i+1].x, body.plugin.trail[i+1].y);
                    ctx.strokeStyle = trailColor;
                    ctx.stroke();
                }
                ctx.globalAlpha = 1.0; // Reset alpha for other rendering
            }

            // 2. DRAW LIVE VELOCITY VECTOR
            const velX = isPaused && body.plugin?.savedVelocity ? body.plugin.savedVelocity.x : body.velocity.x;
            const velY = isPaused && body.plugin?.savedVelocity ? body.plugin.savedVelocity.y : body.velocity.y;

            const speed = Math.hypot(velX, velY);

            // Only draw arrow if moving reasonably fast
            if (speed > 0.5) {
                const startX = body.position.x;
                const startY = body.position.y;
                const scale = 3; 
                const endX = startX + (velX * scale);
                const endY = startY + (velY * scale);

                ctx.beginPath();
                ctx.moveTo(startX, startY);
                ctx.lineTo(endX, endY);
                ctx.strokeStyle = '#00f2ff'; // Cyan neon
                ctx.lineWidth = 3;
                ctx.shadowBlur = 10;
                ctx.shadowColor = '#00f2ff';
                ctx.stroke();

                const angle = Math.atan2(velY, velX);
                const headLength = 10;
                ctx.beginPath();
                ctx.moveTo(endX, endY);
                ctx.lineTo(endX - headLength * Math.cos(angle - Math.PI / 6), endY - headLength * Math.sin(angle - Math.PI / 6));
                ctx.lineTo(endX - headLength * Math.cos(angle + Math.PI / 6), endY - headLength * Math.sin(angle + Math.PI / 6));
                ctx.lineTo(endX, endY);
                ctx.fillStyle = '#00f2ff';
                ctx.fill();

                ctx.shadowBlur = 0; // Reset shadow
            }
        });
    });

    return () => {
      Render.stop(render);
      Runner.stop(runner);
      Engine.clear(engine);
      render.canvas.remove();
    };
  }, []);

  useEffect(() => {
    setApplyBodyChange((id, prop, val) => {
        if (!engineRef.current || isNaN(val)) return;
        const bodies = Matter.Composite.allBodies(engineRef.current.world);
        const target = bodies.find(b => b.plugin && b.plugin.reactId === id && b.label !== 'anchor');
        
        if (target) {
            const isEngineRunning = usePhysicsStore.getState().isRunning;

            if (prop === 'mass') Matter.Body.setMass(target, val);
            if (prop === 'friction') target.friction = val;
            if (prop === 'restitution') target.restitution = val;
            
            if (prop === 'velocityX') {
                if (isEngineRunning) Matter.Body.setVelocity(target, { x: val, y: target.velocity.y });
                else {
                    target.plugin.savedVelocity = target.plugin.savedVelocity || { x: 0, y: 0 };
                    target.plugin.savedVelocity.x = val;
                }
            }
            if (prop === 'velocityY') {
                if (isEngineRunning) Matter.Body.setVelocity(target, { x: target.velocity.x, y: val });
                else {
                    target.plugin.savedVelocity = target.plugin.savedVelocity || { x: 0, y: 0 };
                    target.plugin.savedVelocity.y = val;
                }
            }
        }
    });
  }, [setApplyBodyChange]);

  useEffect(() => {
    if (!engineRef.current) return;
    const bodies = Matter.Composite.allBodies(engineRef.current.world);
    bodies.forEach(body => {
      if (body.label === 'anchor') {
        Matter.Body.setStatic(body, isRunning);
        if (!isRunning) {
            Matter.Body.setVelocity(body, { x: 0, y: 0 });
        }
      }
    });
  }, [isRunning]);

  useEffect(() => {
    if (!engineRef.current) return;
    const { World, Bodies, Constraint, Composite, Body } = Matter; 
    
    const allBodies = Composite.allBodies(engineRef.current.world);
    const existingIds = allBodies.map(b => b.plugin && b.plugin.reactId).filter(Boolean);
    const currentReactIds = entities.map(e => e.id);

    const bodiesToRemove = allBodies.filter(b => b.plugin && b.plugin.reactId && !currentReactIds.includes(b.plugin.reactId));
    if (bodiesToRemove.length > 0) World.remove(engineRef.current.world, bodiesToRemove);

    const newEntities = entities.filter(ent => !existingIds.includes(ent.id));
    const isCurrentlyRunning = usePhysicsStore.getState().isRunning;

    const physicalObjects = newEntities.flatMap(ent => {
      const compositeGroup = Body.nextGroup(true); 

      if (ent.type === 'rectangle') {
        const body = Bodies.rectangle(ent.x, ent.y, ent.width, ent.height, {
          label: 'box', plugin: { reactId: ent.id }, isStatic: ent.isStatic || false,
          restitution: ent.restitution !== undefined ? ent.restitution : 0.8, friction: ent.friction !== undefined ? ent.friction : friction,
          render: { fillStyle: ent.color || '#00f2ff' }
        });
        if (ent.mass) Matter.Body.setMass(body, ent.mass);
        if (ent.initialVelocity) Matter.Body.setVelocity(body, { x: ent.initialVelocity.x || 0, y: ent.initialVelocity.y || 0 });
        return [body];
      } 
      else if (ent.type === 'circle') {
        const body = Bodies.circle(ent.x, ent.y, ent.radius, {
          label: 'ball', plugin: { reactId: ent.id }, isStatic: ent.isStatic || false,
          restitution: ent.restitution !== undefined ? ent.restitution : 0.8, friction: ent.friction !== undefined ? ent.friction : friction,
          render: { fillStyle: ent.color || '#ff0055' }
        });
        if (ent.mass) Matter.Body.setMass(body, ent.mass);
        if (ent.initialVelocity) Matter.Body.setVelocity(body, { x: ent.initialVelocity.x || 0, y: ent.initialVelocity.y || 0 });
        return [body];
      }
      else if (ent.type === 'pendulum') {
        const anchor = Bodies.circle(ent.x, ent.y, 10, { 
            label: 'anchor', isStatic: isCurrentlyRunning, mass: 500, collisionFilter: { group: compositeGroup }, plugin: { reactId: ent.id }, render: { fillStyle: '#aaaaaa' }
        });
        const bob = Bodies.circle(ent.x, ent.y + ent.length, ent.bobRadius || 25, {
            label: 'pendulum_bob', plugin: { reactId: ent.id }, collisionFilter: { group: compositeGroup }, restitution: 0.9, friction: friction, mass: ent.mass || 5.0, render: { fillStyle: ent.color || '#eaff00' }
        });
        const rope = Constraint.create({ bodyA: anchor, bodyB: bob, length: ent.length, stiffness: 1.0, render: { strokeStyle: '#ffffff', lineWidth: 2 } });
        return [anchor, bob, rope]; 
      }
      else if (ent.type === 'spring') {
        const base = Bodies.rectangle(ent.x, ent.y, 120, 10, { 
            label: 'anchor', isStatic: isCurrentlyRunning, mass: 500, collisionFilter: { group: compositeGroup }, plugin: { reactId: ent.id }, render: { fillStyle: '#1a1a1a', strokeStyle: '#00e5ff', lineWidth: 2 } 
        });
        const platform = Bodies.rectangle(ent.x, ent.y - 150, 120, 20, {
            label: 'spring_platform', plugin: { startX: ent.x, reactId: ent.id, baseId: base.id }, collisionFilter: { group: compositeGroup }, restitution: 0.0, friction: friction, mass: 2.0, render: { fillStyle: '#00e5ff' }
        });
        Matter.Body.setInertia(platform, Infinity);
        
        const springLeft = Constraint.create({ bodyA: base, pointA: { x: -45, y: 0 }, bodyB: platform, pointB: { x: -45, y: 0 }, length: 150, stiffness: 0.02, damping: 0.05, render: { strokeStyle: '#00e5ff', lineWidth: 4 } });
        const springRight = Constraint.create({ bodyA: base, pointA: { x: 45, y: 0 }, bodyB: platform, pointB: { x: 45, y: 0 }, length: 150, stiffness: 0.02, damping: 0.05, render: { strokeStyle: '#00e5ff', lineWidth: 4 } });
        return [base, platform, springLeft, springRight];
      }
      else if (ent.type === 'motor') {
        const anchor = Bodies.circle(ent.x, ent.y, 15, { 
            label: 'anchor', isStatic: isCurrentlyRunning, mass: 500, collisionFilter: { group: compositeGroup }, plugin: { reactId: ent.id }, render: { fillStyle: '#ffffff' } 
        });
        const blade = Bodies.rectangle(ent.x, ent.y, ent.length || 200, 20, {
            label: 'motor_blade', plugin: { reactId: ent.id, isMotor: true, speed: ent.speed || 0.1 }, collisionFilter: { group: compositeGroup },
            friction: friction, render: { fillStyle: ent.color || '#ff8800' }
        });
        const joint = Constraint.create({ bodyA: anchor, bodyB: blade, length: 0, stiffness: 1, render: { visible: false } });
        return [anchor, blade, joint];
      }
      else if (ent.type === 'pulley') {
        const loadY = ent.y + (ent.length || 300);
        const anchor = Bodies.circle(ent.x, ent.y, 15, { 
            label: 'anchor', isStatic: isCurrentlyRunning, mass: 500, collisionFilter: { group: compositeGroup }, plugin: { reactId: ent.id }, render: { fillStyle: '#aaaaaa' } 
        });
        const load = Bodies.rectangle(ent.x, loadY, 50, 50, {
            label: 'elevator_load', plugin: { reactId: ent.id }, collisionFilter: { group: compositeGroup }, mass: ent.mass || 10, friction: friction, render: { fillStyle: ent.color || '#aa00ff' }
        });
        const rope = Constraint.create({
            bodyA: anchor, bodyB: load, length: ent.length || 300, stiffness: 0.1,
            plugin: { isWinch: true, speed: ent.speed || 1.0, minLength: 30 }, render: { strokeStyle: '#ffffff', lineWidth: 3 }
        });
        return [anchor, load, rope];
      }
      return [];
    });

    if (physicalObjects.length > 0) {
        const isEnginePaused = !usePhysicsStore.getState().isRunning;
        physicalObjects.forEach(item => {
            if (isEnginePaused && item.type === 'body' && !item.isStatic && item.velocity) {
                item.plugin = item.plugin || {}; 
                item.plugin.savedVelocity = { x: item.velocity.x, y: item.velocity.y };
                item.plugin.savedAngularVelocity = item.angularVelocity || 0;
            }
        });
        World.add(engineRef.current.world, physicalObjects);
    }

    setEngineSnapshot(() => {
        if (!engineRef.current) return [];
        return Composite.allBodies(engineRef.current.world)
            .filter(b => b.label !== "Rectangle Body" && b.label !== "anchor" && b.plugin && b.plugin.reactId) 
            .map(b => ({
                reactId: b.plugin.reactId, type: b.label,
                x: Math.round(b.position.x), y: Math.round(b.position.y),
                velocityX: Math.round((b.plugin.savedVelocity ? b.plugin.savedVelocity.x : b.velocity.x) * 100) / 100, 
                velocityY: Math.round((b.plugin.savedVelocity ? b.plugin.savedVelocity.y : b.velocity.y) * 100) / 100,
                mass: Math.round(b.mass * 100) / 100, friction: Math.round(b.friction * 100) / 100, restitution: Math.round(b.restitution * 100) / 100,
                isStatic: b.isStatic
            }));
    });

  }, [entities, friction, setEngineSnapshot]);

  useEffect(() => {
    if (!engineRef.current) return;
    engineRef.current.world.bodies.forEach(body => {
      if (!body.isStatic) Matter.Body.set(body, 'friction', friction);
    });
  }, [friction]);

  return <div ref={sceneRef} className="absolute inset-0 w-full h-full z-0 pointer-events-auto" />;
}