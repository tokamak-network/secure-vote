#!/bin/bash
# Secure Vote - 완전 자동 데모 실행 스크립트
# 사용법: ./start-demo.sh

set -e

echo "🚀 Secure Vote 데모 시작..."
echo ""

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 현재 디렉토리 확인
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# 클린업 함수
cleanup() {
    echo ""
    echo "🧹 정리 중..."

    # Anvil 프로세스 종료
    if [ ! -z "$ANVIL_PID" ]; then
        kill $ANVIL_PID 2>/dev/null || true
        echo "✓ Anvil 종료"
    fi

    # Next.js 프로세스 종료
    if [ ! -z "$NEXTJS_PID" ]; then
        kill $NEXTJS_PID 2>/dev/null || true
        echo "✓ Next.js 서버 종료"
    fi

    exit 0
}

# Ctrl+C 시 클린업 실행
trap cleanup SIGINT SIGTERM

# 1단계: 기존 프로세스 종료
echo "📋 1단계: 기존 프로세스 정리..."
pkill -f anvil 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
sleep 1
echo -e "${GREEN}✓${NC} 정리 완료"
echo ""

# 2단계: Anvil 시작 (백그라운드)
echo "📋 2단계: Anvil 로컬 블록체인 시작..."
anvil > /tmp/anvil.log 2>&1 &
ANVIL_PID=$!

# Anvil이 준비될 때까지 대기
sleep 2

# Anvil 상태 확인
if ! curl -s -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  http://127.0.0.1:8545 > /dev/null 2>&1; then
  echo -e "${RED}✗${NC} Anvil 시작 실패"
  cat /tmp/anvil.log
  exit 1
fi

echo -e "${GREEN}✓${NC} Anvil 실행 중 (PID: $ANVIL_PID)"
echo "   로그: tail -f /tmp/anvil.log"
echo ""

# 3단계: 스마트 컨트랙트 배포
echo "📋 3단계: 스마트 컨트랙트 배포..."
DEPLOY_OUTPUT=$(forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  2>&1)

# 컨트랙트 주소 추출
CONTRACT_ADDRESS=$(echo "$DEPLOY_OUTPUT" | grep "SecureVoting deployed at:" | awk '{print $4}')

if [ -z "$CONTRACT_ADDRESS" ]; then
  echo -e "${RED}✗${NC} 컨트랙트 배포 실패"
  echo "$DEPLOY_OUTPUT"
  cleanup
  exit 1
fi

echo -e "${GREEN}✓${NC} 컨트랙트 배포됨: ${BLUE}$CONTRACT_ADDRESS${NC}"
echo ""

# 4단계: Frontend 설정
echo "📋 4단계: Frontend 설정..."

cd frontend

# .env.local 생성
echo "NEXT_PUBLIC_CONTRACT_ADDRESS=$CONTRACT_ADDRESS" > .env.local
echo -e "${GREEN}✓${NC} .env.local 생성됨"

# node_modules 확인
if [ ! -d "node_modules" ]; then
    echo "📦 Dependencies 설치 중..."
    npm install > /tmp/npm-install.log 2>&1
    echo -e "${GREEN}✓${NC} Dependencies 설치 완료"
fi

echo ""

# 5단계: Next.js 서버 시작 (백그라운드)
echo "📋 5단계: Next.js 서버 시작..."
npm run dev > /tmp/nextjs.log 2>&1 &
NEXTJS_PID=$!

# Next.js가 준비될 때까지 대기
echo "   서버 준비 중..."
for i in {1..30}; do
    if curl -s http://localhost:3000 > /dev/null 2>&1; then
        break
    fi
    sleep 1
done

if ! curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo -e "${RED}✗${NC} Next.js 서버 시작 실패"
    cat /tmp/nextjs.log
    cleanup
    exit 1
fi

echo -e "${GREEN}✓${NC} Next.js 서버 실행 중 (PID: $NEXTJS_PID)"
echo "   로그: tail -f /tmp/nextjs.log"
echo ""

# 완료!
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ 모든 서비스 실행 완료!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${BLUE}📱 브라우저에서 열기:${NC}"
echo "   http://localhost:3000"
echo ""
echo -e "${YELLOW}⚙️  MetaMask 설정 (최초 1회만):${NC}"
echo ""
echo "   1. MetaMask에서 네트워크 추가:"
echo "      - 네트워크 이름: Anvil"
echo "      - RPC URL: http://127.0.0.1:8545"
echo "      - 체인 ID: 31337"
echo "      - 통화 기호: ETH"
echo ""
echo "   2. 테스트 계정 가져오기:"
echo "      - 개인 키: 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
echo ""
echo -e "${BLUE}🎯 사용 방법:${NC}"
echo "   1. 브라우저에서 'Setup Demo' 클릭"
echo "   2. 'Connect Wallet' 클릭"
echo "   3. 'Vote' 버튼으로 투표"
echo "   4. 'Committee' 페이지에서 'Decrypt & Tally' 클릭"
echo "   5. 결과 확인!"
echo ""
echo -e "${YELLOW}📊 시스템 정보:${NC}"
echo "   - Anvil PID: $ANVIL_PID"
echo "   - Next.js PID: $NEXTJS_PID"
echo "   - Contract: $CONTRACT_ADDRESS"
echo ""
echo -e "${RED}종료하려면 Ctrl+C 누르세요${NC}"
echo ""

# 브라우저 자동 열기 (선택적)
if command -v xdg-open &> /dev/null; then
    sleep 2
    xdg-open http://localhost:3000 2>/dev/null || true
elif command -v open &> /dev/null; then
    sleep 2
    open http://localhost:3000 2>/dev/null || true
fi

# 무한 대기 (사용자가 Ctrl+C 할 때까지)
echo "로그 모니터링 중... (Ctrl+C로 종료)"
echo ""

# 로그 실시간 출력
tail -f /tmp/nextjs.log
