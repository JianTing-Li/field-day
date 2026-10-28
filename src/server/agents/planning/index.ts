// The real agent (planningAgentImpl in ./agent) passes its tests (YT-05), but the lifecycle service tests
// and fixture mode still expect the stub's fixture outputs. Switch here once JT's harness can choose it.
export { planningStub as planningAgent } from "./stub";
