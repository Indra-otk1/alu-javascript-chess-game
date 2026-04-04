const path = require("path");
const express = require("express");
const { Chess } = require("chess.js");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const sourceDirectory = path.join(__dirname, "source code");
const chessLibraryPath = path.join(
  __dirname,
  "node_modules",
  "chess.js",
  "dist",
  "esm"
);
const groqApiUrl = "https://api.groq.com/openai/v1/chat/completions";
const groqModel = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const lichessCloudEvalUrl = "https://lichess.org/api/cloud-eval";
const lichessExplorerUrl = "https://explorer.lichess.ovh/lichess";

app.use(express.json());
app.use(express.static(sourceDirectory));
app.use("/vendor", express.static(chessLibraryPath));

function createGame(fen) {
  return fen ? new Chess(fen) : new Chess();
}

function listMoveHistory(game) {
  return game.history({ verbose: true }).map((move, index) => ({
    index: index + 1,
    color: move.color,
    from: move.from,
    to: move.to,
    san: move.san,
    piece: move.piece,
    promotion: move.promotion || null
  }));
}

function gameStatus(game) {
  const status = game.isGameOver()
    ? game.isCheckmate()
      ? "checkmate"
      : game.isStalemate()
        ? "stalemate"
        : "draw"
    : "active";

  let winner = null;
  if (status === "checkmate") {
    winner = game.turn() === "w" ? "black" : "white";
  }

  return {
    status,
    winner,
    check: game.isCheck(),
    checkmate: game.isCheckmate(),
    stalemate: game.isStalemate()
  };
}

function serializeGame(game, extra = {}) {
  return {
    ok: true,
    fen: game.fen(),
    pgn: game.pgn(),
    moveHistory: listMoveHistory(game),
    ...gameStatus(game),
    ...extra
  };
}

function normalizeMove(move) {
  if (typeof move === "string") {
    return move;
  }

  if (!move || typeof move !== "object" || !move.from || !move.to) {
    return null;
  }

  return {
    from: move.from,
    to: move.to,
    promotion: move.promotion || "q"
  };
}

function legalMoves(game) {
  return game.moves({ verbose: true }).map((move) => ({
    uci: `${move.from}${move.to}${move.promotion || ""}`,
    san: move.san,
    from: move.from,
    to: move.to,
    promotion: move.promotion || null
  }));
}

function moveFromUci(uci) {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci.slice(4, 5) : "q"
  };
}

function parseAiMove(content) {
  if (!content || typeof content !== "string") {
    return null;
  }

  const match = content.trim().match(/[a-h][1-8][a-h][1-8][qrbn]?/i);
  return match ? match[0].toLowerCase() : null;
}

function aiPrompt(game, availableMoves) {
  return [
    {
      role: "system",
      content: [
        "You are a chess engine.",
        "Return exactly one legal move in UCI format.",
        "Do not explain the move.",
        "Do not add punctuation or extra text.",
        "Only choose from the legal move list provided."
      ].join(" ")
    },
    {
      role: "user",
      content: [
        `FEN: ${game.fen()}`,
        `Side to move: ${game.turn() === "w" ? "white" : "black"}`,
        `Legal moves: ${availableMoves.map((move) => move.uci).join(", ")}`,
        "Return one move only."
      ].join("\n")
    }
  ];
}

async function requestGroq(messages) {
  const response = await fetch(groqApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: groqModel,
      temperature: 0.2,
      max_tokens: 12,
      messages
    })
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.message || "Groq request failed.";
    throw new Error(message);
  }

  return body?.choices?.[0]?.message?.content || "";
}

async function generateAiMove(game) {
  const availableMoves = legalMoves(game);
  if (availableMoves.length === 0) {
    throw new Error("No legal moves available.");
  }

  const allowedMoves = new Set(availableMoves.map((move) => move.uci));
  const firstResponse = await requestGroq(aiPrompt(game, availableMoves));
  let aiMove = parseAiMove(firstResponse);

  if (!aiMove || !allowedMoves.has(aiMove)) {
    const retryMessages = [
      ...aiPrompt(game, availableMoves),
      {
        role: "assistant",
        content: firstResponse || "No move returned."
      },
      {
        role: "user",
        content: [
          "Your previous answer was invalid.",
          `Choose exactly one move from this list: ${availableMoves.map((move) => move.uci).join(", ")}`,
          "Return only the move."
        ].join(" ")
      }
    ];
    const retryResponse = await requestGroq(retryMessages);
    aiMove = parseAiMove(retryResponse);
  }

  if (!aiMove || !allowedMoves.has(aiMove)) {
    throw new Error("Groq did not return a valid legal move.");
  }

  return moveFromUci(aiMove);
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}.`);
  }
  return response.json();
}

function formatEvaluation(cloudEval) {
  if (!cloudEval) {
    return null;
  }

  if (typeof cloudEval.mate === "number") {
    return `Mate in ${cloudEval.mate}`;
  }

  if (typeof cloudEval.cp === "number") {
    return (cloudEval.cp / 100).toFixed(2);
  }

  return null;
}

function summarizeExplorerData({ openingName, evaluation, bestMoves, turn }) {
  if (!openingName && !evaluation && bestMoves.length === 0) {
    return `No Lichess reference data is available for this ${turn} move position yet.`;
  }

  const parts = [];
  if (openingName) {
    parts.push(`Opening: ${openingName}.`);
  }
  if (evaluation) {
    parts.push(`Evaluation: ${evaluation}.`);
  }
  if (bestMoves.length > 0) {
    parts.push(`Suggested move${bestMoves.length > 1 ? "s" : ""}: ${bestMoves.join(", ")}.`);
  }

  return parts.join(" ");
}

async function fetchExplorerData(game) {
  const fen = encodeURIComponent(game.fen());
  const headers = process.env.LICHESS_API_TOKEN
    ? { Authorization: `Bearer ${process.env.LICHESS_API_TOKEN}` }
    : {};

  const [cloudEvalResult, openingResult] = await Promise.allSettled([
    fetchJson(`${lichessCloudEvalUrl}?fen=${fen}&multiPv=2`, headers),
    fetchJson(
      `${lichessExplorerUrl}?variant=standard&speeds=rapid,classical,blitz&fen=${fen}`,
      headers
    )
  ]);

  const cloudEval = cloudEvalResult.status === "fulfilled" ? cloudEvalResult.value : null;
  const openingData = openingResult.status === "fulfilled" ? openingResult.value : null;
  const bestMoves = [];

  if (Array.isArray(cloudEval?.pvs)) {
    cloudEval.pvs.slice(0, 2).forEach((variation) => {
      if (variation?.moves) {
        bestMoves.push(variation.moves.split(" ")[0]);
      }
    });
  }

  if (bestMoves.length === 0 && Array.isArray(openingData?.moves)) {
    openingData.moves.slice(0, 2).forEach((move) => {
      if (move?.san) {
        bestMoves.push(move.san);
      }
    });
  }

  const openingName = openingData?.opening?.name || null;
  const evaluation = formatEvaluation(cloudEval);
  return {
    ok: true,
    openingName,
    evaluation,
    bestMoves,
    summary: summarizeExplorerData({
      openingName,
      evaluation,
      bestMoves,
      turn: game.turn() === "w" ? "white" : "black"
    }),
    source: {
      cloudEval: cloudEvalResult.status === "fulfilled" ? "available" : "unavailable",
      explorer: openingResult.status === "fulfilled" ? "available" : "unavailable"
    }
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/game/move", (req, res) => {
  try {
    const game = createGame(req.body?.fen);
    const normalizedMove = normalizeMove(req.body?.move);

    if (!normalizedMove) {
      return res.status(400).json({
        ok: false,
        error: "A move is required."
      });
    }

    const appliedMove = game.move(normalizedMove);
    if (!appliedMove) {
      return res.status(400).json({
        ok: false,
        error: "Invalid move."
      });
    }

    return res.json(serializeGame(game, {
      playerMove: {
        from: appliedMove.from,
        to: appliedMove.to,
        san: appliedMove.san
      }
    }));
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error.message || "Invalid game state."
    });
  }
});

app.post("/api/game/ai-move", (req, res) => {
  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({
        ok: false,
        error: "GROQ_API_KEY is not configured."
      });
    }

    const game = createGame(req.body?.fen);
    if (game.isGameOver()) {
      return res.status(400).json({
        ok: false,
        error: "The game is already over."
      });
    }

    return generateAiMove(game)
      .then((aiMove) => {
        const appliedMove = game.move(aiMove);
        if (!appliedMove) {
          return res.status(502).json({
            ok: false,
            error: "Groq returned an invalid move."
          });
        }

        return res.json(serializeGame(game, {
          aiMove: {
            from: appliedMove.from,
            to: appliedMove.to,
            san: appliedMove.san
          }
        }));
      })
      .catch((error) => {
        return res.status(502).json({
          ok: false,
          error: error.message || "AI move generation failed."
        });
      });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error.message || "Invalid game state."
    });
  }
});

app.post("/api/game/explorer", (req, res) => {
  try {
    const game = createGame(req.body?.fen);
    return fetchExplorerData(game)
      .then((payload) => res.json(payload))
      .catch((error) => {
        return res.status(502).json({
          ok: false,
          error: error.message || "Explorer lookup failed."
        });
      });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      error: error.message || "Invalid game state."
    });
  }
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(sourceDirectory, "index.html"));
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
