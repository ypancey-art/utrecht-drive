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

const HALF = { x: 2, y: 0.35, z: 0.9 };
const WHEEL_RADIUS = 0.4;
const REST_LENGTH = 0.35;
// Front-left, front-right, rear-left, rear-right. Forward is +x, right is +z.
const WHEELS = [
  { x: 1.3, z: -0.85, front: true },
  { x: 1.3, z: 0.85, front: true },
  { x: -1.3, z: -0.85, front: false },
  { x: -1.3, z: 0.85, front: false },
];

export class Car {
  body: RAPIER.RigidBody;
  vehicle: RAPIER.DynamicRayCastVehicleController;
  stats: CarStats;
  private world: RAPIER.World;
  private steer = 0;

  constructor(world: RAPIER.World, stats: CarStats = DEFAULT_STATS) {
    this.world = world;
    this.stats = stats;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setLinearDamping(0.05).setAngularDamping(0.5).setCanSleep(false),
    );
    const volume = 8 * HALF.x * HALF.y * HALF.z;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(HALF.x, HALF.y, HALF.z)
        .setDensity(stats.mass / volume)
        .setFriction(0.4)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS),
      this.body,
    );

    this.vehicle = world.createVehicleController(this.body);
    WHEELS.forEach((w, i) => {
      this.vehicle.addWheel({ x: w.x, y: -0.1, z: w.z }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, REST_LENGTH, WHEEL_RADIUS);
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
    this.body.setTranslation({ x, y: 1.2, z }, true);
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
      const front = WHEELS[i].front;
      this.vehicle.setWheelSteering(i, front ? this.steer : 0);
      this.vehicle.setWheelEngineForce(i, front ? 0 : engine);
      this.vehicle.setWheelBrake(i, input.handbrake && !front ? s.brakeForce * 2 : brake);
      this.vehicle.setWheelSideFrictionStiffness(i, input.handbrake && !front ? 0.35 : 1);
    }
    this.vehicle.updateVehicle(dt);
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
