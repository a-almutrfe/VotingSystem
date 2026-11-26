import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const { time, loadFixture } = networkHelpers;

const Phase = { Registration: 0n, Commit: 1n, Reveal: 2n, Ended: 3n, Cancelled: 4n };
const Outcome = { NoVotes: 0n, Winner: 1n, Tie: 2n, Cancelled: 3n };

function hashVote(id, choice, secret, voterAddress) {
  return ethers.solidityPackedKeccak256(
    ["uint256", "uint256", "bytes32", "address"],
    [id, choice, secret, voterAddress]
  );
}

function secret(text) {
  return ethers.encodeBytes32String(text);
}

async function deployFixture() {
  const [owner, creator, voter1, voter2, voter3, voter4, outsider] = await ethers.getSigners();
  const voting = await ethers.deployContract("VotingSystem");
  return { voting, owner, creator, voter1, voter2, voter3, voter4, outsider };
}

async function electionFixture() {
  const accounts = await deployFixture();
  const { voting, creator, voter1, voter2, voter3, voter4 } = accounts;

  const now = await time.latest();
  const commitStart = now + 1000;
  const commitEnd = now + 2000;
  const revealEnd = now + 3000;

  await voting.connect(creator).createElection("Class Rep", ["Alice", "Bob", "Carol"], commitStart, commitEnd, revealEnd);
  for (const v of [voter1, voter2, voter3, voter4]) {
    await voting.connect(creator).registerVoter(1, v.address);
  }

  return { ...accounts, commitStart, commitEnd, revealEnd };
}

async function commitAll(voting, votes, commitStart, commitEnd) {
  await time.increaseTo(commitStart);
  for (const v of votes) {
    await voting.connect(v.signer).commitVote(1, hashVote(1, v.choice, v.secret, v.signer.address));
  }
  await time.increaseTo(commitEnd);
}

async function revealAll(voting, votes) {
  for (const v of votes) {
    await voting.connect(v.signer).revealVote(1, v.choice, v.secret);
  }
}

describe("VotingSystem", function () {
  describe("Domain 1: Ownership & admin", function () {
    it("sets the deployer as owner", async function () {
      const { voting, owner } = await loadFixture(deployFixture);
      expect(await voting.owner()).to.equal(owner.address);
    });

    it("lets the owner transfer ownership", async function () {
      const { voting, owner, outsider } = await loadFixture(deployFixture);
      await expect(voting.transferOwnership(outsider.address))
        .to.emit(voting, "OwnershipTransferred")
        .withArgs(owner.address, outsider.address);
      expect(await voting.owner()).to.equal(outsider.address);
    });

    it("rejects transfer by a non-owner or to the zero address", async function () {
      const { voting, outsider } = await loadFixture(deployFixture);
      await expect(voting.connect(outsider).transferOwnership(outsider.address)).to.be.revertedWithCustomError(voting, "NotOwner");
      await expect(voting.transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(voting, "ZeroAddress");
    });

    it("pauses and unpauses election creation", async function () {
      const { voting, owner, creator } = await loadFixture(deployFixture);
      const now = await time.latest();

      await expect(voting.pauseCreation()).to.emit(voting, "CreationPaused").withArgs(owner.address);
      await expect(
        voting.connect(creator).createElection("T", ["A", "B"], now + 100, now + 200, now + 300)
      ).to.be.revertedWithCustomError(voting, "CreationIsPaused");

      await expect(voting.unpauseCreation()).to.emit(voting, "CreationUnpaused").withArgs(owner.address);
      await expect(voting.connect(creator).createElection("T", ["A", "B"], now + 100, now + 200, now + 300)).to.emit(
        voting,
        "ElectionCreated"
      );
    });

    it("rejects pause by a non-owner and repeated pause/unpause", async function () {
      const { voting, outsider } = await loadFixture(deployFixture);
      await expect(voting.connect(outsider).pauseCreation()).to.be.revertedWithCustomError(voting, "NotOwner");
      await expect(voting.unpauseCreation()).to.be.revertedWithCustomError(voting, "NotPaused");
      await voting.pauseCreation();
      await expect(voting.pauseCreation()).to.be.revertedWithCustomError(voting, "AlreadyPaused");
    });

    it("lets the creator cancel before voting starts", async function () {
      const { voting, creator } = await loadFixture(electionFixture);
      await expect(voting.connect(creator).cancelElection(1)).to.emit(voting, "ElectionCancelled").withArgs(1);
      expect(await voting.getPhase(1)).to.equal(Phase.Cancelled);
    });

    it("rejects cancel by owner/outsider or after voting starts", async function () {
      const { voting, owner, creator, outsider, commitStart } = await loadFixture(electionFixture);
      await expect(voting.connect(owner).cancelElection(1)).to.be.revertedWithCustomError(voting, "NotCreator");
      await expect(voting.connect(outsider).cancelElection(1)).to.be.revertedWithCustomError(voting, "NotCreator");

      await time.increaseTo(commitStart);
      await expect(voting.connect(creator).cancelElection(1)).to.be.revertedWithCustomError(voting, "VotingStarted");
    });

    it("rejects cancelling an already cancelled election", async function () {
      const { voting, creator } = await loadFixture(electionFixture);
      await voting.connect(creator).cancelElection(1);
      await expect(voting.connect(creator).cancelElection(1)).to.be.revertedWithCustomError(voting, "AlreadyCancelled");
    });
  });

  describe("Domain 2: Election creation & reading", function () {
    it("creates an election and stores its data", async function () {
      const { voting, creator } = await loadFixture(deployFixture);
      const now = await time.latest();

      await expect(voting.connect(creator).createElection("Club Vote", ["Alice", "Bob"], now + 100, now + 200, now + 300))
        .to.emit(voting, "ElectionCreated")
        .withArgs(1, creator.address, "Club Vote", 2);

      expect(await voting.electionCount()).to.equal(1n);
      const e = await voting.getElection(1);
      expect(e.creator).to.equal(creator.address);
      expect(e.title).to.equal("Club Vote");
      expect(e.commitStart).to.equal(BigInt(now + 100));
      expect(e.commitEnd).to.equal(BigInt(now + 200));
      expect(e.revealEnd).to.equal(BigInt(now + 300));
      expect(e.candidateCount).to.equal(2n);
      expect(e.cancelled).to.equal(false);

      const [name, votes] = await voting.getCandidate(1, 1);
      expect(name).to.equal("Bob");
      expect(votes).to.equal(0n);
    });

    it("rejects an empty title, fewer than 2 candidates, or an empty name", async function () {
      const { voting } = await loadFixture(deployFixture);
      const now = await time.latest();
      await expect(voting.createElection("", ["A", "B"], now + 100, now + 200, now + 300)).to.be.revertedWithCustomError(voting, "EmptyText");
      await expect(voting.createElection("T", ["A"], now + 100, now + 200, now + 300)).to.be.revertedWithCustomError(voting, "TooFewCandidates");
      await expect(voting.createElection("T", ["A", ""], now + 100, now + 200, now + 300)).to.be.revertedWithCustomError(voting, "EmptyText");
    });

    it("rejects invalid times", async function () {
      const { voting } = await loadFixture(deployFixture);
      const now = await time.latest();
      await expect(voting.createElection("T", ["A", "B"], now, now + 200, now + 300)).to.be.revertedWithCustomError(voting, "InvalidTimes");
      await expect(voting.createElection("T", ["A", "B"], now + 100, now + 100, now + 300)).to.be.revertedWithCustomError(voting, "InvalidTimes");
      await expect(voting.createElection("T", ["A", "B"], now + 100, now + 200, now + 200)).to.be.revertedWithCustomError(voting, "InvalidTimes");
    });

    it("moves through Registration, Commit, Reveal and Ended phases by time", async function () {
      const { voting, commitStart, commitEnd, revealEnd } = await loadFixture(electionFixture);
      expect(await voting.getPhase(1)).to.equal(Phase.Registration);
      await time.increaseTo(commitStart);
      expect(await voting.getPhase(1)).to.equal(Phase.Commit);
      await time.increaseTo(commitEnd);
      expect(await voting.getPhase(1)).to.equal(Phase.Reveal);
      await time.increaseTo(revealEnd);
      expect(await voting.getPhase(1)).to.equal(Phase.Ended);
    });

    it("rejects reading a non-existent election or candidate", async function () {
      const { voting } = await loadFixture(electionFixture);
      await expect(voting.getElection(0)).to.be.revertedWithCustomError(voting, "ElectionNotFound");
      await expect(voting.getPhase(99)).to.be.revertedWithCustomError(voting, "ElectionNotFound");
      await expect(voting.getCandidate(1, 3)).to.be.revertedWithCustomError(voting, "InvalidCandidate");
    });
  });

  describe("Domain 3: Voter registration", function () {
    it("lets the creator register a voter", async function () {
      const { voting, creator, outsider } = await loadFixture(electionFixture);
      await expect(voting.connect(creator).registerVoter(1, outsider.address))
        .to.emit(voting, "VoterRegistered")
        .withArgs(1, outsider.address);

      expect((await voting.getVoter(1, outsider.address)).registered).to.equal(true);
      expect((await voting.getElection(1)).registeredCount).to.equal(5n);
    });

    it("rejects registration by a non-creator, of the zero address, or twice", async function () {
      const { voting, owner, creator, voter1, outsider } = await loadFixture(electionFixture);
      await expect(voting.connect(owner).registerVoter(1, outsider.address)).to.be.revertedWithCustomError(voting, "NotCreator");
      await expect(voting.connect(creator).registerVoter(1, ethers.ZeroAddress)).to.be.revertedWithCustomError(voting, "ZeroAddress");
      await expect(voting.connect(creator).registerVoter(1, voter1.address)).to.be.revertedWithCustomError(voting, "AlreadyRegistered");
      await expect(voting.connect(creator).registerVoter(99, outsider.address)).to.be.revertedWithCustomError(voting, "ElectionNotFound");
    });

    it("lets the creator remove a voter", async function () {
      const { voting, creator, voter1, outsider } = await loadFixture(electionFixture);
      await expect(voting.connect(creator).removeVoter(1, voter1.address))
        .to.emit(voting, "VoterRemoved")
        .withArgs(1, voter1.address);

      expect((await voting.getVoter(1, voter1.address)).registered).to.equal(false);
      expect((await voting.getElection(1)).registeredCount).to.equal(3n);
      await expect(voting.connect(creator).removeVoter(1, outsider.address)).to.be.revertedWithCustomError(voting, "NotRegistered");
      await expect(voting.connect(voter1).removeVoter(1, voter1.address)).to.be.revertedWithCustomError(voting, "NotCreator");
    });

    it("rejects register/remove after voting starts or on a cancelled election", async function () {
      const { voting, creator, voter1, outsider, commitStart } = await loadFixture(electionFixture);

      await voting.connect(creator).cancelElection(1);
      await expect(voting.connect(creator).registerVoter(1, outsider.address)).to.be.revertedWithCustomError(voting, "WrongPhase");

      const now = await time.latest();
      await voting.connect(creator).createElection("Second", ["A", "B"], now + 100, now + 200, now + 300);
      await voting.connect(creator).registerVoter(2, voter1.address);
      await time.increaseTo(now + 100);
      await expect(voting.connect(creator).registerVoter(2, outsider.address)).to.be.revertedWithCustomError(voting, "WrongPhase");
      await expect(voting.connect(creator).removeVoter(2, voter1.address)).to.be.revertedWithCustomError(voting, "WrongPhase");
    });

    it("keeps voters separate per election", async function () {
      const { voting, creator, voter1 } = await loadFixture(electionFixture);
      const now = await time.latest();
      await voting.connect(creator).createElection("Second", ["A", "B"], now + 100, now + 200, now + 300);
      expect((await voting.getVoter(1, voter1.address)).registered).to.equal(true);
      expect((await voting.getVoter(2, voter1.address)).registered).to.equal(false);
    });
  });

  describe("Domain 4: Commit-reveal & results", function () {
    it("lets a registered voter commit a hidden vote", async function () {
      const { voting, voter1, commitStart } = await loadFixture(electionFixture);
      const hash = hashVote(1, 0, secret("s1"), voter1.address);
      await time.increaseTo(commitStart);

      await expect(voting.connect(voter1).commitVote(1, hash)).to.emit(voting, "VoteCommitted").withArgs(1, voter1.address);
      expect((await voting.getVoter(1, voter1.address)).commitHash).to.equal(hash);
      expect((await voting.getElection(1)).committedCount).to.equal(1n);
    });

    it("rejects commits that are unregistered, outside the window, repeated, or empty", async function () {
      const { voting, creator, voter1, voter2, outsider, commitStart, commitEnd } = await loadFixture(electionFixture);
      const hash = hashVote(1, 0, secret("s1"), voter1.address);

      await expect(voting.connect(voter1).commitVote(1, hash)).to.be.revertedWithCustomError(voting, "WrongPhase");

      await voting.connect(creator).removeVoter(1, voter2.address);
      await time.increaseTo(commitStart);
      await expect(voting.connect(outsider).commitVote(1, hash)).to.be.revertedWithCustomError(voting, "NotRegistered");
      await expect(voting.connect(voter2).commitVote(1, hash)).to.be.revertedWithCustomError(voting, "NotRegistered");
      await expect(voting.connect(voter1).commitVote(1, ethers.ZeroHash)).to.be.revertedWithCustomError(voting, "EmptyHash");

      await voting.connect(voter1).commitVote(1, hash);
      await expect(voting.connect(voter1).commitVote(1, hash)).to.be.revertedWithCustomError(voting, "AlreadyCommitted");

      await time.increaseTo(commitEnd);
      await expect(voting.connect(voter1).commitVote(1, hash)).to.be.revertedWithCustomError(voting, "WrongPhase");
    });

    it("counts a correctly revealed vote", async function () {
      const { voting, voter1, commitStart, commitEnd } = await loadFixture(electionFixture);
      await commitAll(voting, [{ signer: voter1, choice: 2, secret: secret("s1") }], commitStart, commitEnd);

      await expect(voting.connect(voter1).revealVote(1, 2, secret("s1")))
        .to.emit(voting, "VoteRevealed")
        .withArgs(1, voter1.address, 2);

      const [, votes] = await voting.getCandidate(1, 2);
      expect(votes).to.equal(1n);
      expect((await voting.getVoter(1, voter1.address)).revealed).to.equal(true);
      expect((await voting.getElection(1)).revealedCount).to.equal(1n);
    });

    it("rejects reveals that do not match, are repeated, have no commit, or are outside the window", async function () {
      const { voting, voter1, voter2, commitStart, commitEnd, revealEnd } = await loadFixture(electionFixture);
      await time.increaseTo(commitStart);
      await voting.connect(voter1).commitVote(1, hashVote(1, 1, secret("s1"), voter1.address));
      await expect(voting.connect(voter1).revealVote(1, 1, secret("s1"))).to.be.revertedWithCustomError(voting, "WrongPhase");

      await time.increaseTo(commitEnd);
      await expect(voting.connect(voter1).revealVote(1, 0, secret("s1"))).to.be.revertedWithCustomError(voting, "HashMismatch");
      await expect(voting.connect(voter1).revealVote(1, 1, secret("wrong"))).to.be.revertedWithCustomError(voting, "HashMismatch");
      await expect(voting.connect(voter1).revealVote(1, 5, secret("s1"))).to.be.revertedWithCustomError(voting, "InvalidCandidate");
      await expect(voting.connect(voter2).revealVote(1, 1, secret("s1"))).to.be.revertedWithCustomError(voting, "NoCommit");

      await voting.connect(voter1).revealVote(1, 1, secret("s1"));
      await expect(voting.connect(voter1).revealVote(1, 1, secret("s1"))).to.be.revertedWithCustomError(voting, "AlreadyRevealed");

      await time.increaseTo(revealEnd);
      await expect(voting.connect(voter2).revealVote(1, 1, secret("s2"))).to.be.revertedWithCustomError(voting, "WrongPhase");
    });

    it("stops a voter from copying another voter's hash", async function () {
      const { voting, voter1, voter2, commitStart, commitEnd } = await loadFixture(electionFixture);
      const hash1 = hashVote(1, 0, secret("s1"), voter1.address);
      await time.increaseTo(commitStart);
      await voting.connect(voter1).commitVote(1, hash1);
      await voting.connect(voter2).commitVote(1, hash1);

      await time.increaseTo(commitEnd);
      await voting.connect(voter1).revealVote(1, 0, secret("s1"));
      await expect(voting.connect(voter2).revealVote(1, 0, secret("s1"))).to.be.revertedWithCustomError(voting, "HashMismatch");
    });

    it("declares a winner", async function () {
      const { voting, voter1, voter2, voter3, commitStart, commitEnd, revealEnd } = await loadFixture(electionFixture);
      const votes = [
        { signer: voter1, choice: 1, secret: secret("a") },
        { signer: voter2, choice: 1, secret: secret("b") },
        { signer: voter3, choice: 0, secret: secret("c") },
      ];
      await commitAll(voting, votes, commitStart, commitEnd);
      await revealAll(voting, votes);

      let r = await voting.getResult(1);
      expect(r.isFinal).to.equal(false);

      await time.increaseTo(revealEnd);
      r = await voting.getResult(1);
      expect(r.outcome).to.equal(Outcome.Winner);
      expect(r.winner).to.equal(1n);
      expect(r.topVotes).to.equal(2n);
      expect(r.isFinal).to.equal(true);
    });

    it("declares a tie", async function () {
      const { voting, voter1, voter2, voter3, voter4, commitStart, commitEnd, revealEnd } =
        await loadFixture(electionFixture);
      const votes = [
        { signer: voter1, choice: 0, secret: secret("a") },
        { signer: voter2, choice: 1, secret: secret("b") },
        { signer: voter3, choice: 0, secret: secret("c") },
        { signer: voter4, choice: 1, secret: secret("d") },
      ];
      await commitAll(voting, votes, commitStart, commitEnd);
      await revealAll(voting, votes);
      await time.increaseTo(revealEnd);

      const r = await voting.getResult(1);
      expect(r.outcome).to.equal(Outcome.Tie);
      expect(r.topVotes).to.equal(2n);
    });

    it("clears a tie when a later vote breaks it", async function () {
      const { voting, voter1, voter2, voter3, commitStart, commitEnd } = await loadFixture(electionFixture);
      const votes = [
        { signer: voter1, choice: 0, secret: secret("a") },
        { signer: voter2, choice: 2, secret: secret("b") },
        { signer: voter3, choice: 2, secret: secret("c") },
      ];
      await commitAll(voting, votes, commitStart, commitEnd);

      await revealAll(voting, votes.slice(0, 2));
      expect((await voting.getResult(1)).outcome).to.equal(Outcome.Tie);

      await revealAll(voting, votes.slice(2));
      const r = await voting.getResult(1);
      expect(r.outcome).to.equal(Outcome.Winner);
      expect(r.winner).to.equal(2n);
    });

    it("reports no votes when nobody reveals", async function () {
      const { voting, voter1, commitStart, commitEnd, revealEnd } = await loadFixture(electionFixture);
      await commitAll(voting, [{ signer: voter1, choice: 0, secret: secret("a") }], commitStart, commitEnd);
      await time.increaseTo(revealEnd);

      const r = await voting.getResult(1);
      expect(r.outcome).to.equal(Outcome.NoVotes);
      expect(r.topVotes).to.equal(0n);
      expect((await voting.getElection(1)).committedCount).to.equal(1n);
      expect((await voting.getElection(1)).revealedCount).to.equal(0n);
    });

    it("binds the vote hash to one election", async function () {
      const { voting, creator, voter1, commitStart, commitEnd } = await loadFixture(electionFixture);

      await voting.connect(creator).createElection("Second", ["A", "B"], commitStart, commitEnd, commitEnd + 1000);
      await voting.connect(creator).registerVoter(2, voter1.address);

      const hashForElection1 = hashVote(1, 0, secret("same"), voter1.address);
      await time.increaseTo(commitStart);
      await voting.connect(voter1).commitVote(2, hashForElection1);

      await time.increaseTo(commitEnd);
      await expect(voting.connect(voter1).revealVote(2, 0, secret("same"))).to.be.revertedWithCustomError(
        voting,
        "HashMismatch"
      );
    });

    it("reports a cancelled election in the result", async function () {
      const { voting, creator } = await loadFixture(electionFixture);
      await voting.connect(creator).cancelElection(1);
      expect((await voting.getResult(1)).outcome).to.equal(Outcome.Cancelled);
    });
  });
});
