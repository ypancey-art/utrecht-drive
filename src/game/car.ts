import RAPIER from '@dimforge/rapier3d-compat';

/** Tunable car stats. Different cars and upgrades will change these (phase 3). */
export interface CarStats {
  mass: number; // kg
  engineForce: number; // N per driven wheel
  brakeForce: number;
  maxSpeed: number; // m/s
  maxSteer: number; // radians
  grip: number; // tyre friction slip
}

export const DEFAULT_STATS: CarStats = {
  mass: 1100,
  engineForce: 2600,
  brakeForce: 60,
  maxSpeed: 22, // ~80 km/h
  maxSteer: 0.55,
  grip: 3,
};

export interface DriveInput { throttle: number; steer: number; handbrake: boolean }

export interface CarBody { length: number; width: number; wheelR: number; wheelbase: number; track?: number }
const DEFAULT_BODY: CarBody = { length: 4, width: 1.8, wheelR: 0.4, wheelbase: 2.6 };
const REST_LENGTH = 0.35;
/** Height of the ground below the chassis centre when the car stands still. */
export const groundOffset = (wheelR: number) => 0.1 + 0.28 + wheelR;

export class Car {
  body: RAPIER.RigidBody;
  vehicle: RAPIER.DynamicRayCastVehicleController;
  stats: CarStats;
  private world: RAPIER.World;
  private steer = 0;

  private wheels: { x: number; z: number; front: boolean }[];
  wheelR: number;
  collider: RAPIER.Collider;

  constructor(world: RAPIER.World, stats: CarStats = DEFAULT_STATS, dims: CarBody = DEFAULT_BODY) {
    this.world = world;
    this.stats = stats;
    this.wheelR = dims.wheelR;
    const HALF = { x: dims.length / 2, y: 0.4, z: dims.width / 2 };
    const wx = dims.wheelbase / 2, wz = dims.track ?? dims.width / 2 - 0.2;
    // Front-left, front-right, rear-left, rear-right. Forward is +x, right is +z.
    this.wheels = [
      { x: wx, z: -wz, front: true },
      { x: wx, z: wz, front: true },
      { x: -wx, z: -wz, front: false },
      { x: -wx, z: wz, front: false },
    ];
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setLinearDamping(0.05).setAngularDamping(0.5).setCanSleep(false),
    );
    const volume = 8 * HALF.x * HALF.y * HALF.z;
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(HALF.x, HALF.y, HALF.z)
        .setDensity(stats.mass / volume)
        .setFriction(0.4)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(stats.mass * 12),
      this.body,
    );

    this.vehicle = world.createVehicleController(this.body);
    this.wheels.forEach((w, i) => {
      this.vehicle.addWheel({ x: w.x, y: -0.1, z: w.z }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, REST_LENGTH, dims.wheelR);
      this.vehicle.setWheelSuspensionStiffness(i, 30);
      this.vehicle.setWheelSuspensionCompression(i, 4.4);
      this.vehicle.setWheelSuspensionRelaxation(i, 2.3);
      this.vehicle.setWheelMaxSuspensionTravel(i, 0.3);
      this.vehicle.setWheelFrictionSlip(i, stats.grip);
      this.vehicle.setWheelSideFrictionStiffness(i, 1);
    });
  }

  /** Puts the car on the ground at (x, z), facing direction (dirX, dirZ). */
  place(x: number, z: number, dirX: number, dirZ: number) {
    const yaw = Math.atan2(-dirZ, dirX); // rotation about +y that turns +x into (dirX, dirZ)
    this.body.setTranslation({ x, y: groundOffset(this.wheelR) + 0.3, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Signed forward speed in m/s. */
  get speed() {
    return this.vehicle.currentVehicleSpeed();
  }

  update(input: DriveInput, dt: number) {
    const s = this.stats;
    const speed = this.speed;
    // Less steering at high speed so it stays controllable for kids.
    const steerLimit = s.maxSteer * (1 - Math.min(Math.abs(speed) / (s.maxSpeed * 1.6), 0.6));
    const target = -input.steer * steerLimit; // positive steer input = turn right
    this.steer += (target - this.steer) * Math.min(1, dt * 8);

    let engine = 0;
    let brake = 0;
    if (input.throttle > 0) {
      if (speed < -0.5) brake = s.brakeForce; // was reversing: brake first
      else if (speed < s.maxSpeed) engine = s.engineForce * input.throttle;
    } else if (input.throttle < 0) {
      if (speed > 0.5) brake = s.brakeForce; // moving forward: brake
      else if (speed > -s.maxSpeed * 0.35) engine = s.engineForce * 0.6 * input.throttle; // reverse
    } else {
      // Gentle roll-off; hold the car still when (almost) stopped.
      brake = Math.abs(speed) < 1 ? s.brakeForce : s.brakeForce * 0.05;
    }

    for (let i = 0; i < 4; i++) {
      const front = this.wheels[i].front;
      this.vehicle.setWheelSteering(i, front ? this.steer : 0);
      this.vehicle.setWheelEngineForce(i, front ? 0 : engine);
      this.vehicle.setWheelBrake(i, input.handbrake && !front ? s.brakeForce * 2 : brake);
      this.vehicle.setWheelSideFrictionStiffness(i, input.handbrake && !front ? 0.35 : 1);
    }
    this.vehicle.updateVehicle(dt);
  }

  /** Sinking in water: physics off, the car drifts, tips nose-down and goes under. */
  sinking = 0; // seconds since the car hit the water (0 = not sinking)
  private sinkVel = { x: 0, z: 0 };
  startSinking() {
    const v = this.body.linvel();
    this.sinkVel = { x: v.x * 0.5, z: v.z * 0.5 };
    this.sinking = 0.0001;
    this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
  }
  updateSinking(dt: number) {
    this.sinking += dt;
    const p = this.body.translation();
    const drag = Math.exp(-dt * 1.5);
    this.sinkVel.x *= drag;
    this.sinkVel.z *= drag;
    const y = Math.max(-2.6, p.y - dt * (0.4 + this.sinking * 0.5));
    this.body.setNextKinematicTranslation({ x: p.x + this.sinkVel.x * dt, y, z: p.z + this.sinkVel.z * dt });
    // Tip the nose down (rotate about the car's own sideways axis).
    const r = this.body.rotation();
    const a = Math.min(this.sinking, 2) * 0.12 * dt;
    const s = Math.sin(a / 2), c = Math.cos(a / 2);
    // q * (rotation about local z by -a)
    const qz = -s;
    this.body.setNextKinematicRotation({
      x: r.w * 0 + r.x * c + r.y * qz - r.z * 0,
      y: r.w * 0 - r.x * qz + r.y * c + r.z * 0,
      z: r.w * qz + r.x * 0 - r.y * 0 + r.z * c,
      w: r.w * c - r.x * 0 - r.y * 0 - r.z * qz,
    });
  }
  stopSinking() {
    this.sinking = 0;
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
  }

  /** True if the car is lying on its side or roof. */
  get flipped() {
    const r = this.body.rotation();
    const upY = 1 - 2 * (r.x * r.x + r.z * r.z); // y component of the local up axis
    return upY < 0.3;
  }

  wheelState(i: number) {
    const c = this.vehicle.wheelChassisConnectionPointCs(i)!;
    const len = this.vehicle.wheelSuspensionLength(i) ?? REST_LENGTH;
    return {
      x: c.x,
      y: c.y - len,
      z: c.z,
      steering: this.vehicle.wheelSteering(i) ?? 0,
      rotation: this.vehicle.wheelRotation(i) ?? 0,
    };
  }

  dispose() {
    this.world.removeVehicleController(this.vehicle);
    this.world.removeRigidBody(this.body);
  }
}
