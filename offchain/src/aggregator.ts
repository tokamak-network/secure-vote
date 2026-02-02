import { MerkleTree } from 'merkletreejs';
import { keccak256 } from 'ethers';
import { Ciphertext, serializeCiphertext } from './crypto/elgamal';
import { DecryptionShare, thresholdDecrypt } from './crypto/dkg';

/**
 * Vote aggregator with Merkle tree for fraud proofs
 */

export interface Vote {
  voter: string; // Ethereum address
  ciphertext: Ciphertext;
  timestamp: number;
}

export interface DecryptedVote {
  voter: string;
  vote: bigint; // 0 = no, 1 = yes
  timestamp: number;
}

export interface TallyResult {
  yesVotes: number;
  noVotes: number;
  totalVotes: number;
  votesRoot: string; // Merkle root (bytes32)
  votes: DecryptedVote[];
}

/**
 * Aggregator for votes
 */
export class VoteAggregator {
  private votes: Map<string, Vote>;

  constructor() {
    this.votes = new Map();
  }

  /**
   * Add encrypted vote (supports overwrite)
   */
  addVote(voter: string, ciphertext: Ciphertext, timestamp: number): void {
    const existingVote = this.votes.get(voter);

    // Overwrite if newer timestamp
    if (!existingVote || timestamp > existingVote.timestamp) {
      this.votes.set(voter, { voter, ciphertext, timestamp });
    }
  }

  /**
   * Get all votes (for decryption)
   */
  getVotes(): Vote[] {
    return Array.from(this.votes.values());
  }

  /**
   * Decrypt all votes using threshold decryption shares
   *
   * @param sharesMap Map of voter address to decryption shares
   * @returns Array of decrypted votes
   */
  decryptVotes(
    sharesMap: Map<string, DecryptionShare[]>
  ): DecryptedVote[] {
    const decryptedVotes: DecryptedVote[] = [];

    for (const [voter, voteData] of this.votes.entries()) {
      const shares = sharesMap.get(voter);
      if (!shares) {
        throw new Error(`No decryption shares for voter ${voter}`);
      }

      const decryptedValue = thresholdDecrypt(voteData.ciphertext, shares);
      if (decryptedValue === null) {
        throw new Error(`Failed to decrypt vote from ${voter}`);
      }

      decryptedVotes.push({
        voter,
        vote: decryptedValue,
        timestamp: voteData.timestamp,
      });
    }

    return decryptedVotes;
  }

  /**
   * Tally votes and generate Merkle root
   *
   * @param decryptedVotes Array of decrypted votes
   * @returns Tally result with Merkle root
   */
  tallyVotes(decryptedVotes: DecryptedVote[]): TallyResult {
    let yesVotes = 0;
    let noVotes = 0;

    for (const vote of decryptedVotes) {
      if (vote.vote === 1n) {
        yesVotes++;
      } else if (vote.vote === 0n) {
        noVotes++;
      } else {
        throw new Error(`Invalid vote value: ${vote.vote}`);
      }
    }

    // Build Merkle tree
    const leaves = decryptedVotes.map((vote, index) =>
      keccak256(
        Buffer.from(
          JSON.stringify({
            index,
            voter: vote.voter,
            vote: vote.vote.toString(),
            timestamp: vote.timestamp,
          })
        )
      )
    );

    const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
    const root = tree.getRoot().toString('hex');

    return {
      yesVotes,
      noVotes,
      totalVotes: decryptedVotes.length,
      votesRoot: '0x' + root,
      votes: decryptedVotes,
    };
  }

  /**
   * Generate Merkle proof for a specific vote
   *
   * @param decryptedVotes All decrypted votes
   * @param voteIndex Index of vote to prove
   * @returns Merkle proof (array of hashes)
   */
  generateMerkleProof(
    decryptedVotes: DecryptedVote[],
    voteIndex: number
  ): string[] {
    const leaves = decryptedVotes.map((vote, index) =>
      keccak256(
        Buffer.from(
          JSON.stringify({
            index,
            voter: vote.voter,
            vote: vote.vote.toString(),
            timestamp: vote.timestamp,
          })
        )
      )
    );

    const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
    const leaf = leaves[voteIndex];
    const proof = tree.getProof(leaf);

    return proof.map(p => '0x' + p.data.toString('hex'));
  }

  /**
   * Verify Merkle proof
   *
   * @param vote Vote to verify
   * @param voteIndex Index of vote
   * @param proof Merkle proof
   * @param root Merkle root
   * @returns true if proof is valid
   */
  static verifyMerkleProof(
    vote: DecryptedVote,
    voteIndex: number,
    proof: string[],
    root: string
  ): boolean {
    const leaf = keccak256(
      Buffer.from(
        JSON.stringify({
          index: voteIndex,
          voter: vote.voter,
          vote: vote.vote.toString(),
          timestamp: vote.timestamp,
        })
      )
    );

    const proofBuffers = proof.map(p => Buffer.from(p.slice(2), 'hex'));
    const tree = new MerkleTree([], keccak256, { sortPairs: true });

    return tree.verify(proofBuffers, leaf, Buffer.from(root.slice(2), 'hex'));
  }
}

/**
 * Helper: Create decryption shares for all votes
 *
 * @param votes All votes to decrypt
 * @param secretShares Committee members' secret shares
 * @returns Map of voter to decryption shares
 */
export function createAllDecryptionShares(
  votes: Vote[],
  secretShares: Array<{ memberIndex: number; share: any }>
): Map<string, DecryptionShare[]> {
  const { createDecryptionShare } = require('./crypto/dkg');

  const sharesMap = new Map<string, DecryptionShare[]>();

  for (const vote of votes) {
    const shares: DecryptionShare[] = [];

    for (const member of secretShares) {
      const share = createDecryptionShare(
        vote.ciphertext,
        member.share,
        member.memberIndex
      );
      shares.push(share);
    }

    sharesMap.set(vote.voter, shares);
  }

  return sharesMap;
}
