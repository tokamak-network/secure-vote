# Secure Vote - TODO

## 현재 방향: MACI + Fraud Proof

**목표:**
- Trustless bribery-free 투표
- ZKP는 challenge 시에만 (비용 절감)
- MACI 키 변경으로 bribery 방어

**상세 설계:** `maci-fraud-proof-design.md`
**구현 계획:** `implementation-plan.md`
**UI 설계:** `ui-design.md`
**연구 자료:** `research/` 폴더

---

## 구현 체크리스트

### Phase 1: 핵심 암호화 (Week 1) ✅
- [x] `offchain/src/crypto/maci/keys.ts` - 키 생성/변경
- [x] `offchain/src/crypto/maci/encryption.ts` - 메시지 암호화
- [x] `offchain/src/crypto/maci/index.ts` - 모듈 exports
- [x] `offchain/test/maci-keys.test.ts` - 테스트 (22개 통과)

### Phase 2: Coordinator (Week 2) ✅
- [x] `offchain/src/coordinator/state.ts` - State 관리
- [x] `offchain/src/coordinator/processor.ts` - 메시지 처리
- [x] `offchain/src/coordinator/index.ts` - 모듈 exports
- [x] `offchain/test/coordinator.test.ts` - 테스트 (25개 통과)

### Phase 3: Smart Contract (Week 3) ✅
- [x] `src/MACIVoting.sol` - 메인 컨트랙트
- [x] `test/MACIVoting.t.sol` - 컨트랙트 테스트 (27개 통과)
- [x] Challenge/Response 메커니즘

### Phase 4: 통합 (Week 4) ✅
- [x] `frontend/lib/crypto-wrapper.ts` - MACI 모듈 추가
- [x] `frontend/lib/contracts.ts` - MACIVoting ABI 추가
- [x] `frontend/pages/maci/index.tsx` - MACI 프로포절 목록
- [x] `frontend/pages/maci/vote/[id].tsx` - 키 관리 + 투표
- [x] `frontend/pages/maci/coordinator.tsx` - Coordinator 대시보드
- [x] `frontend/pages/api/maci/*.ts` - API 엔드포인트
- [x] `offchain/src/index.ts` - MACI/Coordinator export

### Phase 5: ZKP Circuit ✅ (2026-02-07 구현)
- [x] ZKP 툴체인 설정 (circom, snarkjs, circomlibjs)
- [x] Poseidon 해시 마이그레이션 (SHA256 → Poseidon)
- [x] Witness/Proof 생성기 구현
- [x] Smart Contract verifier 연동
- [x] E2E 테스트 (23개 off-chain, 7개 on-chain 통과)

### Phase 5b: ZKP 실제 동작 ✅ (2026-02-07)
- [x] circom 설치 (소스 빌드)
- [x] Powers of Tau 다운로드 (pot15.ptau)
- [x] Circuit 컴파일 → WASM, zkey, verification_key.json 생성
- [x] circom 2.x 호환: component 선언 수정, include 경로 수정
- [x] 실제 Groth16 proof 생성/검증 (Node.js, snarkjs)
- [x] GeneratedVerifier.sol 생성 (실제 pairing check)
- [x] On-chain 실제 proof 검증 테스트 (3개 추가, 모두 통과)
- [x] Proof fixture 저장 (test/fixtures/real-proof.json)
- [x] 13 public signals로 전체 코드 정합성 맞춤

---

## ZKP 구현 상세 (Phase 5)

### 새로운 파일
| 파일 | 설명 |
|------|------|
| `circuits/package.json` | Circuit 빌드 의존성 |
| `scripts/setup-zkp.sh` | Powers of Tau 다운로드 |
| `scripts/compile-circuit.sh` | Circuit 컴파일 스크립트 |
| `offchain/src/crypto/poseidon.ts` | Poseidon 해시 유틸리티 |
| `offchain/src/zkp/witness.ts` | Witness 생성 |
| `offchain/src/zkp/prover.ts` | Proof 생성 |
| `offchain/src/zkp/index.ts` | ZKP 모듈 exports |
| `offchain/test/zkp-e2e.test.ts` | E2E 테스트 |
| `test/ZKPIntegration.t.sol` | Solidity 통합 테스트 |
| `test/fixtures/*.json` | 테스트 픽스처 |

### 수정된 파일
| 파일 | 변경 |
|------|------|
| `offchain/package.json` | circomlibjs, snarkjs 추가 |
| `offchain/src/coordinator/state.ts` | Poseidon 마이그레이션 (async) |
| `offchain/src/coordinator/processor.ts` | async 변환, proof 생성 추가 |
| `src/Verifier.sol` | IVerifier 인터페이스 + VerifierWrapper |
| `src/MACIVoting.sol` | verifier 연동, proof 파라미터 변경 |
| `src/BisectionGame.sol` | verifier 연동, proof 파라미터 변경 |
| `foundry.toml` | via_ir 활성화 |

### 사용법

1. **ZKP 툴체인 설치:**
```bash
# circom 설치 (필요시)
cargo install circom

# Powers of Tau 다운로드
./scripts/setup-zkp.sh

# Circuit 컴파일
./scripts/compile-circuit.sh
```

2. **테스트 실행:**
```bash
# Off-chain 테스트
cd offchain && bun test zkp-e2e.test.ts

# On-chain 테스트
forge test --match-contract ZKPIntegration
```

3. **Verifier 배포:**
```bash
# 컴파일된 circuit에서 GeneratedVerifier.sol 생성됨
# 배포 후 MACIVoting.setVerifier(address) 호출
```

---

## 완료된 작업

### 연구 및 설계
- [x] 옵션 비교 분석 (`research/voting-options-comparison.md`)
- [x] ZKP 없이 분석 (`research/no-zkp-analysis.md`)
- [x] MACI + Fraud Proof 설계 (`maci-fraud-proof-design.md`)
- [x] 구현 계획 수립 (`implementation-plan.md`)

### 이전 구현 (Legacy - Silent Setup)
- [x] `offchain/src/crypto/silent-setup.ts` - n-of-n threshold
- [x] `offchain/src/crypto/elgamal.ts` - 기본 암호화
- [x] `offchain/test/silent-setup.test.ts` - 24개 테스트 통과
- [x] `frontend/` - 데모 프론트엔드

### Phase 6: UI 개편 + Real Decryption ✅
- [x] `frontend/styles/globals.css` - Snapshot 스타일 다크 테마
- [x] `frontend/components/Layout.tsx` - 네비게이션 리디자인
- [x] `frontend/pages/maci/index.tsx` - 프로포절 카드 UI
- [x] `frontend/pages/maci/vote/[id].tsx` - 투표 UI
- [x] `frontend/pages/maci/results/[id].tsx` - 결과 시각화
- [x] `frontend/pages/api/maci/setup-demo.ts` - Coordinator 키 저장
- [x] `frontend/pages/api/maci/process-tally.ts` - 진짜 MACI 복호화

---

## 검증 방법

### UI 검증
1. `./start-all.sh` 실행
2. http://localhost:3001/maci 접속
3. 다크 모드 UI 확인
4. 카드 스타일, 그라디언트, 호버 효과 확인

### MACI 복호화 검증
1. "Setup Demo" 클릭하여 새 proposal 생성
2. 지갑 연결 후 투표 (For 또는 Against)
3. 시간 skip: `cast rpc evm_increaseTime 1800`
4. "Process & Tally" 클릭
5. 결과 확인 - **실제 투표한 값이 반영되는지 확인**
6. Finalize 후 Results 페이지에서 검증

### ZKP 테스트 검증
```bash
# Off-chain (25 tests pass)
cd offchain && bun test zkp-e2e.test.ts --timeout 60000

# On-chain (10 tests pass: 7 mock + 3 real verifier)
~/.foundry/bin/forge test --match-contract "ZKPIntegration|GeneratedVerifier" -vvv

# 실제 proof 생성 (Node.js 필요 - bun은 snarkjs worker 비호환)
cd offchain && node test-proof.mjs
```

---

## 다음 단계 (선택사항)

- [x] ~~실제 circuit 컴파일 및 GeneratedVerifier.sol 생성~~ ✅ Done
- [ ] 프로덕션용 trusted setup (multi-party ceremony)
- [ ] Gas 최적화
- [ ] 기존 BisectionGame 테스트 업데이트 (legacy proof 데이터 수정)
- [ ] Witness 생성 시 실제 Merkle tree 정합성 개선 (processor → prover 연동)

---

## 완료됨 (2024-2026)
