// The real agent (logisticsAgentImpl in ./agent) passes its tests (JT-12), but fixture mode and the lifecycle
// tests still expect the stub's fixture outputs. The orchestrator chooses stub or real (JT-10).
export { logisticsStub as logisticsAgent } from "./stub";
