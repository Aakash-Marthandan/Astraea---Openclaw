const profileParams = {
    containerTag: "agent_identifier"
};

const mockSemanticProfilePayload = {
    endpoint: "/api/v1/profile",
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer sm_placeholder_key_pending"
    },
    body: {
        ...profileParams,
        condensedState: {
            activeNamespaces: ["agent_identifier"],
            compactionStatus: "ready",
            lastTurnTimestamp: new Date().toISOString()
        }
    }
};

console.log("--- Mock Semantic Profile Payload Generated ---");
console.log(JSON.stringify(mockSemanticProfilePayload, null, 2));
