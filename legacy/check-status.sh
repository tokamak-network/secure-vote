#!/bin/bash
# 블록체인 상태 확인 스크립트

CONTRACT=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
RPC=http://127.0.0.1:8545

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 Secure Vote 블록체인 상태"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 제안 정보
echo "📋 제안 #0:"
PROPOSAL=$(cast call $CONTRACT "proposals(uint256)" 0 --rpc-url $RPC 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "   제목: Should we upgrade the protocol?"
    echo "   상태: ✅ 활성"
else
    echo "   ❌ 아직 생성되지 않음 (Setup Demo 필요)"
fi
echo ""

# 집계 정보
echo "🗳️  집계 결과 #0:"
TALLY=$(cast call $CONTRACT "tallies(uint256)(uint256,uint256,bytes32,uint256,address,bool,bool)" 0 --rpc-url $RPC 2>/dev/null)
if [ $? -eq 0 ]; then
    YES=$(echo "$TALLY" | head -1)
    NO=$(echo "$TALLY" | head -2 | tail -1)
    ROOT=$(echo "$TALLY" | head -3 | tail -1)

    if [ "$YES" != "0" ] || [ "$NO" != "0" ]; then
        echo "   찬성: $YES 표"
        echo "   반대: $NO 표"
        echo "   Merkle Root: $ROOT"
        TOTAL=$((YES + NO))
        echo "   총계: $TOTAL 표"

        if [ $YES -gt $NO ]; then
            echo "   결과: 🎉 통과"
        elif [ $NO -gt $YES ]; then
            echo "   결과: ❌ 거부"
        else
            echo "   결과: ⚖️  동점"
        fi
    else
        echo "   ⏳ 아직 집계되지 않음"
    fi
else
    echo "   ❌ 집계 데이터 없음"
fi
echo ""

# 블록 정보
echo "⛓️  블록체인 상태:"
BLOCK=$(cast block-number --rpc-url $RPC 2>/dev/null)
echo "   현재 블록: #$BLOCK"
echo ""

# 웹 UI 링크
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🌐 웹에서 확인하기:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "   홈:       http://localhost:3000"
echo "   투표:     http://localhost:3000/vote/0"
echo "   위원회:   http://localhost:3000/committee"
echo "   결과:     http://localhost:3000/results/0"
echo ""
