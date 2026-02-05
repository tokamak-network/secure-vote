# Secure Vote - TODO

## 현재 방향: MACI + Fraud Proof

**목표:**
- Trustless bribery-free 투표
- ZKP는 challenge 시에만 (비용 절감)
- MACI 키 변경으로 bribery 방어

**상세 설계:** `maci-fraud-proof-design.md`
**구현 계획:** `implementation-plan.md`
**연구 자료:** `research/` 폴더

---

## 구현 체크리스트

### Phase 1: 핵심 암호화 (Week 1)
- [ ] `offchain/src/crypto/maci/keys.ts` - 키 생성/변경
- [ ] `offchain/src/crypto/maci/encryption.ts` - 메시지 암호화
- [ ] `offchain/test/maci-keys.test.ts` - 테스트

### Phase 2: Coordinator (Week 2)
- [ ] `offchain/src/coordinator/state.ts` - State 관리
- [ ] `offchain/src/coordinator/processor.ts` - 메시지 처리
- [ ] `offchain/test/coordinator.test.ts` - 테스트

### Phase 3: Smart Contract (Week 3)
- [ ] `src/MACIVoting.sol` - 메인 컨트랙트
- [ ] `test/MACIVoting.t.sol` - 컨트랙트 테스트
- [ ] Challenge/Response 메커니즘

### Phase 4: 통합 (Week 4)
- [ ] E2E 통합 테스트
- [ ] 프론트엔드 연동

### Phase 5: ZKP Circuit (선택)
- [ ] Challenge용 circuit 설계
- [ ] Circom/Noir 구현
- [ ] Verifier 컨트랙트

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

---

## 다음 액션

1. **디렉토리 구조 생성**
   ```bash
   mkdir -p offchain/src/crypto/maci offchain/src/coordinator
   ```

2. **keys.ts 구현 시작**
   - VoterKeyPair 인터페이스
   - generateVoterKeyPair()
   - changeKey()

3. **테스트 작성**
