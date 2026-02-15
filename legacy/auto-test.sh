#!/bin/bash
# Secure Vote - 완전 자동 E2E 테스트
# MetaMask 없이 전체 플로우를 터미널에서 테스트
# 사용법: ./auto-test.sh

set -e

echo "🤖 Secure Vote 자동 테스트 시작..."
echo ""

# 색상
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# 클린업
cleanup() {
    echo ""
    echo "🧹 정리 중..."
    [ ! -z "$ANVIL_PID" ] && kill $ANVIL_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

# 1. Anvil 시작
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}1️⃣  Anvil 로컬 블록체인 시작${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

pkill -f anvil 2>/dev/null || true
sleep 1

anvil > /tmp/anvil-test.log 2>&1 &
ANVIL_PID=$!
sleep 2

if ! curl -s -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  http://127.0.0.1:8545 > /dev/null; then
  echo -e "${RED}✗ Anvil 시작 실패${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Anvil 실행 중${NC}"
echo ""

# 2. 컨트랙트 배포
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}2️⃣  스마트 컨트랙트 배포${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

DEPLOY_OUTPUT=$(forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  2>&1)

CONTRACT_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "SecureVoting deployed at:" | awk '{print $4}')

if [ -z "$CONTRACT_ADDRESS" ]; then
  echo -e "${RED}✗ 컨트랙트 배포 실패${NC}"
  cleanup
  exit 1
fi

echo -e "${GREEN}✓ SecureVoting 배포됨${NC}"
echo -e "   주소: ${BLUE}$CONTRACT_ADDRESS${NC}"
echo ""

# 3. 오프체인 라이브러리 빌드
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}3️⃣  오프체인 라이브러리 빌드${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

cd offchain

if [ ! -d "node_modules" ]; then
    npm install > /dev/null 2>&1
fi

npm run build > /dev/null 2>&1

echo -e "${GREEN}✓ 라이브러리 빌드 완료${NC}"
echo ""

# 4. 통합 테스트 실행 (기존 full-flow.ts 사용)
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}4️⃣  E2E 통합 테스트 실행${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

export CONTRACT_ADDRESS=$CONTRACT_ADDRESS

# 통합 테스트 실행 및 결과 파싱
TEST_OUTPUT=$(npm run integration 2>&1)

echo "$TEST_OUTPUT"

# 테스트 결과 확인
if echo "$TEST_OUTPUT" | grep -q "The system is working end-to-end"; then
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✅ 모든 테스트 통과!${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${MAGENTA}📊 테스트 요약:${NC}"
    echo -e "   ${GREEN}✓${NC} Threshold 키 생성 (3/5)"
    echo -e "   ${GREEN}✓${NC} 제안 생성"
    echo -e "   ${GREEN}✓${NC} 암호화된 투표 제출 (3표)"
    echo -e "   ${GREEN}✓${NC} Threshold 복호화"
    echo -e "   ${GREEN}✓${NC} 투표 집계 및 Merkle 트리 생성"
    echo -e "   ${GREEN}✓${NC} 온체인 집계 제출"
    echo -e "   ${GREEN}✓${NC} Merkle 증명 검증"
    echo ""

    # 최종 결과 조회
    echo -e "${MAGENTA}🎯 최종 결과:${NC}"
    TALLY=$(cast call $CONTRACT_ADDRESS \
      "tallies(uint256)(uint256,uint256,bytes32,uint256,address,bool,bool)" \
      0 \
      --rpc-url http://127.0.0.1:8545)

    YES_VOTES=$(echo $TALLY | awk '{print $1}')
    NO_VOTES=$(echo $TALLY | awk '{print $2}')

    echo -e "   ${GREEN}찬성:${NC} $YES_VOTES 표"
    echo -e "   ${RED}반대:${NC} $NO_VOTES 표"
    echo -e "   ${BLUE}총계:${NC} $((YES_VOTES + NO_VOTES)) 표"
    echo ""

    if [ $YES_VOTES -gt $NO_VOTES ]; then
        echo -e "   ${GREEN}🎉 제안 통과!${NC}"
    elif [ $NO_VOTES -gt $YES_VOTES ]; then
        echo -e "   ${RED}❌ 제안 거부${NC}"
    else
        echo -e "   ${YELLOW}⚖️  동점${NC}"
    fi
    echo ""

    echo -e "${BLUE}💡 웹 UI 테스트를 원하시면:${NC}"
    echo -e "   ${YELLOW}./start-demo.sh${NC}"
    echo ""

else
    echo ""
    echo -e "${RED}✗ 테스트 실패${NC}"
    cleanup
    exit 1
fi

cleanup
