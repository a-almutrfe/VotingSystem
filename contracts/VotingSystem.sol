pragma solidity 0.8.39;

contract VotingSystem {
    enum Phase { Registration, Commit, Reveal, Ended, Cancelled }

    enum Outcome { NoVotes, Winner, Tie, Cancelled }

    struct Election {
        address creator;
        uint64 commitStart;
        uint32 candidateCount;
        uint64 commitEnd;
        uint64 revealEnd;
        uint32 registeredCount;
        uint32 committedCount;
        uint32 revealedCount;
        bool isTie;
        bool cancelled;
        uint32 leader;
        uint32 topVotes;
        string title;
    }

    struct Voter {
        bytes32 commitHash;
        bool registered;
        bool revealed;
    }

    address public owner;
    bool public creationPaused;
    uint256 public electionCount;

    mapping(uint256 => Election) elections;
    mapping(uint256 => mapping(uint256 => string)) candidateNames;
    mapping(uint256 => mapping(uint256 => uint256)) candidateVotes;
    mapping(uint256 => mapping(address => Voter)) voters;

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event CreationPaused(address indexed by);
    event CreationUnpaused(address indexed by);
    event ElectionCreated(uint256 indexed id, address indexed creator, string title, uint256 candidateCount);
    event ElectionCancelled(uint256 indexed id);
    event VoterRegistered(uint256 indexed id, address indexed voter);
    event VoterRemoved(uint256 indexed id, address indexed voter);
    event VoteCommitted(uint256 indexed id, address indexed voter);
    event VoteRevealed(uint256 indexed id, address indexed voter, uint256 choice);

    error NotOwner();
    error NotCreator();
    error ElectionNotFound();
    error ZeroAddress();
    error AlreadyPaused();
    error NotPaused();
    error CreationIsPaused();
    error AlreadyCancelled();
    error VotingStarted();
    error EmptyText();
    error TooFewCandidates();
    error InvalidTimes();
    error InvalidCandidate();
    error WrongPhase();
    error AlreadyRegistered();
    error NotRegistered();
    error AlreadyCommitted();
    error EmptyHash();
    error NoCommit();
    error AlreadyRevealed();
    error HashMismatch();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier electionExists(uint256 id) {
        if (id == 0 || id > electionCount) revert ElectionNotFound();
        _;
    }

    modifier onlyCreator(uint256 id) {
        if (msg.sender != elections[id].creator) revert NotCreator();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function pauseCreation() external onlyOwner {
        if (creationPaused) revert AlreadyPaused();
        creationPaused = true;
        emit CreationPaused(msg.sender);
    }

    function unpauseCreation() external onlyOwner {
        if (!creationPaused) revert NotPaused();
        creationPaused = false;
        emit CreationUnpaused(msg.sender);
    }

    function cancelElection(uint256 id) external electionExists(id) onlyCreator(id) {
        Election storage e = elections[id];
        if (e.cancelled) revert AlreadyCancelled();
        if (block.timestamp >= e.commitStart) revert VotingStarted();
        e.cancelled = true;
        emit ElectionCancelled(id);
    }

    function createElection(
        string calldata title,
        string[] calldata names,
        uint64 commitStart,
        uint64 commitEnd,
        uint64 revealEnd
    ) external returns (uint256) {
        if (creationPaused) revert CreationIsPaused();
        if (bytes(title).length == 0) revert EmptyText();
        uint256 count = names.length;
        if (count < 2) revert TooFewCandidates();
        if (commitStart <= block.timestamp || commitEnd <= commitStart || revealEnd <= commitEnd) {
            revert InvalidTimes();
        }

        uint256 id = electionCount + 1;
        electionCount = id;

        Election storage e = elections[id];
        e.creator = msg.sender;
        e.title = title;
        e.commitStart = commitStart;
        e.commitEnd = commitEnd;
        e.revealEnd = revealEnd;
        e.candidateCount = uint32(count);

        for (uint256 i = 0; i < count; i++) {
            if (bytes(names[i]).length == 0) revert EmptyText();
            candidateNames[id][i] = names[i];
        }

        emit ElectionCreated(id, msg.sender, title, count);
        return id;
    }

    function getElection(uint256 id) external view electionExists(id) returns (Election memory) {
        return elections[id];
    }

    function getCandidate(uint256 id, uint256 index)
        external
        view
        electionExists(id)
        returns (string memory name, uint256 votes)
    {
        if (index >= elections[id].candidateCount) revert InvalidCandidate();
        return (candidateNames[id][index], candidateVotes[id][index]);
    }

    function getPhase(uint256 id) public view electionExists(id) returns (Phase) {
        Election storage e = elections[id];
        if (e.cancelled) {
            return Phase.Cancelled;
        }
        if (block.timestamp < e.commitStart) {
            return Phase.Registration;
        }
        if (block.timestamp < e.commitEnd) {
            return Phase.Commit;
        }
        if (block.timestamp < e.revealEnd) {
            return Phase.Reveal;
        }
        return Phase.Ended;
    }

    function registerVoter(uint256 id, address voter) external electionExists(id) onlyCreator(id) {
        if (getPhase(id) != Phase.Registration) revert WrongPhase();
        if (voter == address(0)) revert ZeroAddress();
        Voter storage v = voters[id][voter];
        if (v.registered) revert AlreadyRegistered();

        v.registered = true;
        elections[id].registeredCount += 1;
        emit VoterRegistered(id, voter);
    }

    function removeVoter(uint256 id, address voter) external electionExists(id) onlyCreator(id) {
        if (getPhase(id) != Phase.Registration) revert WrongPhase();
        Voter storage v = voters[id][voter];
        if (!v.registered) revert NotRegistered();

        v.registered = false;
        elections[id].registeredCount -= 1;
        emit VoterRemoved(id, voter);
    }

    function getVoter(uint256 id, address voter) external view electionExists(id) returns (Voter memory) {
        return voters[id][voter];
    }

    function commitVote(uint256 id, bytes32 hash) external electionExists(id) {
        if (getPhase(id) != Phase.Commit) revert WrongPhase();
        Voter storage v = voters[id][msg.sender];
        if (!v.registered) revert NotRegistered();
        if (v.commitHash != bytes32(0)) revert AlreadyCommitted();
        if (hash == bytes32(0)) revert EmptyHash();

        v.commitHash = hash;
        elections[id].committedCount += 1;
        emit VoteCommitted(id, msg.sender);
    }

    function revealVote(uint256 id, uint256 choice, bytes32 secret) external electionExists(id) {
        if (getPhase(id) != Phase.Reveal) revert WrongPhase();
        Election storage e = elections[id];
        Voter storage v = voters[id][msg.sender];
        bytes32 stored = v.commitHash;
        if (stored == bytes32(0)) revert NoCommit();
        if (v.revealed) revert AlreadyRevealed();
        if (choice >= e.candidateCount) revert InvalidCandidate();
        if (keccak256(abi.encodePacked(id, choice, secret, msg.sender)) != stored) {
            revert HashMismatch();
        }

        v.revealed = true;
        e.revealedCount += 1;
        uint256 votes = candidateVotes[id][choice] + 1;
        candidateVotes[id][choice] = votes;

        uint256 top = e.topVotes;
        if (votes > top) {
            e.leader = uint32(choice);
            e.topVotes = uint32(votes);
            e.isTie = false;
        } else if (votes == top && choice != e.leader) {
            e.isTie = true;
        }

        emit VoteRevealed(id, msg.sender, choice);
    }

    function getResult(uint256 id)
        external
        view
        electionExists(id)
        returns (Outcome outcome, uint256 winner, uint256 topVotes, bool isFinal)
    {
        Election storage e = elections[id];
        topVotes = e.topVotes;
        if (e.cancelled) {
            outcome = Outcome.Cancelled;
        } else if (topVotes == 0) {
            outcome = Outcome.NoVotes;
        } else if (e.isTie) {
            outcome = Outcome.Tie;
        } else {
            outcome = Outcome.Winner;
        }
        winner = e.leader;
        isFinal = block.timestamp >= e.revealEnd;
    }
}
