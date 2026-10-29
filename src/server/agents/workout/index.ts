// The real agent (workoutAgentImpl in ./agent) passes its tests (YT-06), but fixture mode and the lifecycle
// tests still expect the stub's fixture outputs. Switch here together with Planning once JT's harness can choose.
export { workoutStub as workoutAgent } from "./stub";
