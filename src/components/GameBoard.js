import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';

const GameBoard = ({ walletAddress, setInGame, chipsAvailable }) => {
  const canvasRef = useRef(null);
  const socketRef = useRef(null);
  const size = 15;
  const cellSize = 40;
  const [gameOver, setGameOver] = useState(false);
  const [matching, setMatching] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  let board = Array(size).fill(null).map(() => Array(size).fill(null));
  let currentPlayer = 'black';
  let playerColor = 'black';
  let room = null;
  let matchingInterval = null;
  let lastMove = null;

  const startMatching = () => {
    setMatching(true);
    const startButton = document.getElementById('startMatching');
    startButton.disabled = true;
    startButton.innerText = 'Matching...';
    let isVisible = true;
    matchingInterval = setInterval(() => {
      startButton.style.visibility = isVisible ? 'visible' : 'hidden';
      isVisible = !isVisible;
    }, 500);
  };

  const stopMatching = () => {
    setMatching(false);
    const startButton = document.getElementById('startMatching');
    clearInterval(matchingInterval);
    startButton.style.visibility = 'visible';
    startButton.disabled = false;
    startButton.innerText = 'Start Matching';
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    socketRef.current = io('https://moniomok.xyz:3001', {
      secure: true,
      rejectUnauthorized: false,
      query: { walletAddress }
    });

    const socket = socketRef.current;

    const blackStone = new Image();
    blackStone.src = 'black.png';

    const whiteStone = new Image();
    whiteStone.src = 'white.png';

    const clickSound = new Audio('click.wav');

    const drawBoard = () => {
      ctx.fillStyle = '#d2b48c';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          ctx.strokeRect(i * cellSize, j * cellSize, cellSize, cellSize);
        }
      }
    };

    const drawStone = (x, y, player) => {
      const centerX = x * cellSize;
      const centerY = y * cellSize;
      const offset = cellSize * 0.1;
      const stoneSize = cellSize - offset * 2;

      if (player === 'black') {
        ctx.drawImage(blackStone, centerX + offset, centerY + offset, stoneSize, stoneSize);
      } else {
        ctx.drawImage(whiteStone, centerX + offset, centerY + offset, stoneSize, stoneSize);
      }
    };

    const drawLastMove = (x, y) => {
      const centerX = x * cellSize + cellSize / 2;
      const centerY = y * cellSize + cellSize / 2;
      const radius = cellSize * 0.1;

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.fillStyle = 'red';
      ctx.fill();
      ctx.closePath();
    };

    const handleCanvasClick = (event) => {
      if (gameOver) return;
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor((event.clientX - rect.left) / cellSize);
      const y = Math.floor((event.clientY - rect.top) / cellSize);

      if (!board[y][x] && currentPlayer === playerColor) {
        board[y][x] = currentPlayer;
        drawStone(x, y, currentPlayer);
        clickSound.play();
        if (lastMove) {
          drawStone(lastMove.x, lastMove.y, board[lastMove.y][lastMove.x]);
        }
        drawLastMove(x, y);
        lastMove = { x, y };

        if (checkWin(x, y, currentPlayer)) {
          socket.emit('gameOver', { room, winner: playerColor });
          setGameOver(true);
        } else {
          socket.emit('makeMove', { room, x, y, player: currentPlayer });
        }
      }
    };

    const checkWin = (x, y, player) => {
      return (
        checkDirection(x, y, player, 1, 0) ||
        checkDirection(x, y, player, 0, 1) ||
        checkDirection(x, y, player, 1, 1) ||
        checkDirection(x, y, player, 1, -1)
      );
    };

    const checkDirection = (x, y, player, dx, dy) => {
      let count = 1;
      for (let i = 1; i < 5; i++) {
        if (board[y + i * dy]?.[x + i * dx] === player) {
          count++;
        } else {
          break;
        }
      }
      for (let i = 1; i < 5; i++) {
        if (board[y - i * dy]?.[x - i * dx] === player) {
          count++;
        } else {
          break;
        }
      }
      if (count === 5) {
        // Check for exact 5 in a row, if there are more than 5, it's not a win
        if (board[y + 5 * dy]?.[x + 5 * dx] === player || board[y - 5 * dy]?.[x - 5 * dx] === player) {
          return false;
        }
        return true;
      }
      return false;
    };

    canvas.addEventListener('click', handleCanvasClick);

    socket.on('startGame', ({ room: roomName, player }) => {
      room = roomName;
      playerColor = player;
      currentPlayer = 'black';
      board = Array(size).fill(null).map(() => Array(size).fill(null));
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawBoard();
      document.getElementById('lobby').style.display = 'none';
      document.getElementById('game').style.display = 'block';
      document.getElementById('status').innerText = `You are playing as ${player}`;
      stopMatching();
      document.getElementById('backToLobby').style.display = 'block';
      setGameOver(false);
      setInGame(true);
    });

    socket.on('moveMade', ({ x, y, player }) => {
      board[y][x] = player;
      drawStone(x, y, player);
      clickSound.play();
      if (lastMove) {
        drawStone(lastMove.x, lastMove.y, board[lastMove.y][lastMove.x]);
      }
      drawLastMove(x, y);
      lastMove = { x, y };
      if (checkWin(x, y, player)) {
        document.getElementById('status').innerText = `${player} wins!`;
        setGameOver(true);
      } else {
        currentPlayer = player === 'black' ? 'white' : 'black';
      }
    });

    socket.on('gameOver', ({ winner }) => {
      document.getElementById('status').innerText = `${winner} wins!`;
      setGameOver(true);
      setInGame(false);
    });

    socket.on('opponentLeft', ({ totalMoves }) => {
      if (!gameOver) {
        document.getElementById('status').innerText = 'Your opponent has left the game. You win!';
      }
      setGameOver(true);
      setInGame(false);
    });

    socket.on('timerUpdate', ({ timeLeft }) => {
      setTimeLeft(timeLeft);
    });

    return () => {
      socket.disconnect();
      canvas.removeEventListener('click', handleCanvasClick);
    };
  }, [walletAddress, gameOver, setInGame]);

  return (
    <div>
      <div id="lobby">
        <button id="startMatching" onClick={() => {
          if (chipsAvailable) {
            socketRef.current.emit('startMatching');
            startMatching();
          } else {
            alert('You need to have chips to start matching.');
          }
        }}>Start Matching</button>
      </div>
      <div id="game" style={{ display: 'none' }}>
        <canvas ref={canvasRef} width={600} height={600}></canvas> 
        <p id="status"></p>
        <p id="timer">Time left: {timeLeft}s</p>
        <button id="backToLobby" style={{ display: 'none' }} onClick={() => window.location.reload()}>Back to Lobby</button>
      </div>
    </div>
  );
};

export default GameBoard;
