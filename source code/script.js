import { Chess } from "/vendor/chess.js";

const game = new Chess();
const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
const pieces = {
 wp: "\u265F\uFE0E",
  wr: "\u265C\uFE0E",
  wn: "\u265E\uFE0E",
  wb: "\u265D\uFE0E",
  wq: "\u265B\uFE0E",
  wk: "\u265A\uFE0E",
  bp: "\u265F\uFE0E",
  br: "\u265C\uFE0E",
  bn: "\u265E\uFE0E",
  bb: "\u265D\uFE0E",
  bq: "\u265B\uFE0E",
  bk: "\u265A\uFE0E"
};

const state = {
  selectedSquare: "",
  highlightedSquares: [],
  explorerRequestId: 0,
  busy: false
};

function idToSquare(id) {
  const [fileIndex, rank] = id.split("_");
  return `${files[Number(fileIndex) - 1]}${rank}`;
}

function squareToId(square) {
  const fileIndex = files.indexOf(square[0]) + 1;
  const rank = square[1];
  return `${fileIndex}_${rank}`;
}

function clearHighlights() {
  state.highlightedSquares.forEach((square) => {
    const element = document.getElementById(squareToId(square));
    if (element) {
      element.classList.remove("green", "shake-little", "neongreen_txt");
    }
  });
  state.highlightedSquares = [];
}

function highlightSquares(squares) {
  clearHighlights();
  state.highlightedSquares = squares.slice();
  state.highlightedSquares.forEach((square) => {
    const element = document.getElementById(squareToId(square));
    if (element) {
      element.classList.add("green", "shake-little", "neongreen_txt");
    }
  });
}

function setGameStatus(message) {
  document.getElementById("game-status").textContent = message;
}

function setBusyState(isBusy, message = "") {
  state.busy = isBusy;
  document.getElementById("reset-game").disabled = isBusy;
  if (message) {
    setGameStatus(message);
  }
}

function updateTurnBanner(message) {
  const turnBanner = document.getElementById("turn");
  turnBanner.textContent = message;
  turnBanner.classList.add("turnhighlight");
  window.setTimeout(() => {
    turnBanner.classList.remove("turnhighlight");
  }, 750);
}

function updateMoveHistory() {
  const history = game.history();
  document.getElementById("move-history").textContent =
    `Moves: ${history.length ? history.join(" ") : "--"}`;
}

function updateExplorerContent(data) {
  document.getElementById("explorer-summary").textContent =
    data.summary || "No analysis available right now.";
  document.getElementById("explorer-opening").textContent =
    `Opening: ${data.openingName || "--"}`;
  document.getElementById("explorer-best-moves").textContent =
    `Best moves: ${data.bestMoves?.length ? data.bestMoves.join(", ") : "--"}`;
}

async function refreshExplorer() {
  const requestId = ++state.explorerRequestId;
  updateExplorerContent({
    summary: "Loading analysis...",
    openingName: "--",
    bestMoves: []
  });

  try {
    const response = await fetch("/api/game/explorer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fen: game.fen(),
        moveHistory: game.history()
      })
    });

    const payload = await response.json();
    if (requestId !== state.explorerRequestId) {
      return;
    }

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Explorer request failed.");
    }

    updateExplorerContent(payload);
  } catch (_error) {
    if (requestId !== state.explorerRequestId) {
      return;
    }

    updateExplorerContent({
      summary: "Lichess analysis is unavailable right now.",
      openingName: "--",
      bestMoves: []
    });
  }
}

function statusMessage() {
  if (game.isCheckmate()) {
    const winner = game.turn() === "w" ? "Black" : "White";
    return `Checkmate! ${winner} wins.`;
  }

  if (game.isStalemate()) {
    return "Stalemate.";
  }

  if (game.isDraw()) {
    return "Draw.";
  }

  const player = game.turn() === "w" ? "White" : "Black";
  if (game.isCheck()) {
    return `${player} to move. Check!`;
  }

  return `It's ${player}s Turn!`;
}

function renderBoard() {
  document.querySelectorAll(".gamecell").forEach((cell) => {
    const square = idToSquare(cell.id);
    const piece = game.get(square);
    if (piece) {
      cell.textContent = pieces[`${piece.color}${piece.type}`];
      cell.setAttribute("chess", `${piece.color}_${piece.type}`);
    } else {
      cell.textContent = "";
      cell.setAttribute("chess", "null");
    }
  });

  document.getElementById("turn").textContent = statusMessage();
}

function selectSquare(square) {
  const moves = game.moves({ square, verbose: true });
  state.selectedSquare = square;
  highlightSquares(moves.map((move) => move.to));
}

function resetSelection() {
  state.selectedSquare = "";
  clearHighlights();
}

function applyServerState(payload) {
  game.load(payload.fen);
  resetSelection();
  renderBoard();
  updateMoveHistory();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

async function requestAiMove() {
  setBusyState(true, "AI is thinking...");

  try {
    const payload = await postJson("/api/game/ai-move", {
      fen: game.fen(),
      moveHistory: game.history()
    });

    applyServerState(payload);
    await refreshExplorer();
    updateTurnBanner(statusMessage());
    setGameStatus(`AI played ${payload.aiMove.san}.`);
  } catch (error) {
    setGameStatus(
      `${error.message || "AI move failed."} Add your Groq key or reset the game to start over.`
    );
  } finally {
    setBusyState(false);
  }
}

async function submitPlayerMove(targetSquare) {
  const move = {
    from: state.selectedSquare,
    to: targetSquare,
    promotion: "q"
  };
  let waitingForAi = false;

  setBusyState(true, "Submitting move...");

  try {
    const payload = await postJson("/api/game/move", {
      fen: game.fen(),
      move,
      moveHistory: game.history()
    });

    applyServerState(payload);
    await refreshExplorer();
    updateTurnBanner(statusMessage());
    setGameStatus(`You played ${payload.playerMove.san}.`);

    if (payload.status === "active" && game.turn() === "b") {
      waitingForAi = true;
      await requestAiMove();
    }
  } catch (error) {
    setGameStatus(error.message || "Move failed.");
    setBusyState(false);
  } finally {
    if (!waitingForAi) {
      setBusyState(false);
    }
  }
}

function resetGame() {
  game.reset();
  resetSelection();
  renderBoard();
  updateMoveHistory();
  refreshExplorer();
  setBusyState(false);
  setGameStatus("Game reset. You are playing as White.");
}

function onCellClick(event) {
  if (state.busy || game.turn() !== "w") {
    return;
  }

  const target = event.currentTarget;
  const square = idToSquare(target.id);
  const piece = game.get(square);

  if (!state.selectedSquare) {
    if (piece && piece.color === "w") {
      selectSquare(square);
    }
    return;
  }

  if (square === state.selectedSquare) {
    resetSelection();
    return;
  }

  if (state.highlightedSquares.includes(square)) {
    submitPlayerMove(square);
    return;
  }

  if (piece && piece.color === "w") {
    selectSquare(square);
    return;
  }

  resetSelection();
}

document.addEventListener("DOMContentLoaded", () => {
  renderBoard();
  updateMoveHistory();
  refreshExplorer();
  document.querySelectorAll(".gamecell").forEach((cell) => {
    cell.addEventListener("click", onCellClick);
  });
  document.getElementById("reset-game").addEventListener("click", resetGame);

  document.body.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
});
