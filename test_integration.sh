#!/bin/bash
# Bee Network Integration Test Script

set -e

echo "=== Bee Network Integration Test ==="

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ORCHESTRATOR_URL="http://localhost:8080"

# Function to check if service is running
check_service() {
    local url=$1
    local name=$2
    if curl -s "$url" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} $name is running"
        return 0
    else
        echo -e "${RED}✗${NC} $name is not running"
        return 1
    fi
}

# Step 1: Start Orchestrator
echo -e "\n${YELLOW}Step 1: Starting Orchestrator...${NC}"
ORCHESTRATOR_ADDR=0.0.0.0:8080 cargo run --package bee-orchestrator &
ORCH_PID=$!
echo "Orchestrator PID: $ORCH_PID"

# Wait for orchestrator to start
sleep 5

# Check orchestrator health
if ! check_service "$ORCHESTRATOR_URL/health" "Orchestrator"; then
    echo "Orchestrator failed to start"
    kill $ORCH_PID 2>/dev/null
    exit 1
fi

# Step 2: Submit test task
echo -e "\n${YELLOW}Step 2: Submitting test task...${NC}"
TASK_RESPONSE=$(curl -s -X POST "$ORCHESTRATOR_URL/tasks?target=https://httpbin.org/get&method=GET&timeout_secs=30&reward_amount=10000000")
echo "Task response: $TASK_RESPONSE"
TASK_ID=$(echo $TASK_RESPONSE | grep -o '"task_id":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TASK_ID" ]; then
    echo -e "${RED}Failed to get task_id${NC}"
    kill $ORCH_PID 2>/dev/null
    exit 1
fi
echo -e "${GREEN}Task submitted: $TASK_ID${NC}"

# Step 3: Start Bee Node
echo -e "\n${YELLOW}Step 3: Starting Bee Node...${NC}"
cargo run --package bee-node &
NODE_PID=$!
echo "Node PID: $NODE_PID"

# Wait for node to connect
sleep 10

# Step 4: Check nodes registered
echo -e "\n${YELLOW}Step 4: Checking registered nodes...${NC}"
curl -s "$ORCHESTRATOR_URL/nodes" | jq .

# Step 5: Poll for task completion
echo -e "\n${YELLOW}Step 5: Polling for task completion...${NC}"
MAX_ATTEMPTS=30
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    STATUS_RESPONSE=$(curl -s "$ORCHESTRATOR_URL/tasks/$TASK_ID")
    STATUS=$(echo $STATUS_RESPONSE | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
    
    echo "Attempt $((ATTEMPT+1))/$MAX_ATTEMPTS - Status: $STATUS"
    
    if [ "$STATUS" = "completed" ]; then
        echo -e "${GREEN}✓ Task completed successfully!${NC}"
        echo $STATUS_RESPONSE | jq .
        break
    elif [ "$STATUS" = "failed" ]; then
        echo -e "${RED}✗ Task failed${NC}"
        echo $STATUS_RESPONSE | jq .
        break
    fi
    
    sleep 5
    ATTEMPT=$((ATTEMPT+1))
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
    echo -e "${RED}✗ Task timed out${NC}"
fi

# Cleanup
echo -e "\n${YELLOW}Cleaning up...${NC}"
kill $NODE_PID 2>/dev/null
kill $ORCH_PID 2>/dev/null

echo -e "\n${GREEN}=== Test Complete ===${NC}"