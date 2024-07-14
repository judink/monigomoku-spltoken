const fs = require('fs');
const express = require('express');
const https = require('https');
const socketIo = require('socket.io');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');

const app = express();
const db = new sqlite3.Database('./database.db');

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS users (wallet_address TEXT PRIMARY KEY, chip_count INTEGER DEFAULT 0)");
});

app.use(cors());
app.use(express.json());

try {
    const options = {
        key: fs.readFileSync('private.key'),
        cert: fs.readFileSync('omok.crt'),
        ca: fs.readFileSync('omok.ca-bundle')
    };

    const server = https.createServer(options, app);
    const io = socketIo(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    const PORT = process.env.PORT || 3001;

    let waitingPlayer = null;
    let rooms = {};

    const startTurnTimer = (room, player) => {
        clearInterval(rooms[room].timerInterval);
        rooms[room].timeLeft = 30;
        rooms[room].timerInterval = setInterval(() => {
            rooms[room].timeLeft -= 1;
            io.to(room).emit('timerUpdate', { timeLeft: rooms[room].timeLeft });
            if (rooms[room].timeLeft <= 0) {
                const winner = player === 'black' ? 'white' : 'black';
                const winnerAddress = rooms[room].playersMap[winner];
                io.to(room).emit('gameOver', { winner: winnerAddress });
                clearInterval(rooms[room].timerInterval);
                rooms[room].gameOver = true;
                closeRoom(room, 'Time over');
                sendReward(winnerAddress);
            }
        }, 1000);
    };

    const closeRoom = (room, reason) => {
        if (rooms[room]) {
            rooms[room].players.forEach(id => {
                const socket = io.sockets.sockets.get(id);
                if (socket) {
                    socket.leave(room);
                }
            });
            clearInterval(rooms[room].timerInterval);
            delete rooms[room];
            console.log(`Room ${room} closed: ${reason}`);
        }
    };

    const sendReward = (winnerAddress) => {
        fetch('http://localhost:4000/sendReward', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ winner: winnerAddress })
        }).then(response => {
            if (response.ok) {
                console.log(`Reward sent to ${winnerAddress}`);
            } else {
                console.error('Failed to send reward');
            }
        }).catch(error => {
            console.error('Error sending reward:', error);
        });
    };

    const consumeChips = (room) => {
        const players = rooms[room].players;
        players.forEach(playerId => {
            const playerSocket = io.sockets.sockets.get(playerId);
            if (playerSocket) {
                const walletAddress = playerSocket.handshake.query.walletAddress;
                db.run("UPDATE users SET chip_count = chip_count - 1 WHERE wallet_address = ?", [walletAddress], function(err) {
                    if (err) {
                        console.error(`Error consuming chip for wallet ${walletAddress}: ${err.message}`);
                    }
                });
            }
        });
    };

    io.on('connection', (socket) => {
        console.log('a user connected');

        socket.on('startMatching', () => {
            if (waitingPlayer) {
                const room = 'room-' + waitingPlayer.id + '-' + socket.id;
                rooms[room] = { 
                    players: [waitingPlayer.id, socket.id], 
                    currentPlayer: 'black', 
                    board: Array(15).fill(null).map(() => Array(15).fill(null)), 
                    timerInterval: null, 
                    timeLeft: 30, 
                    gameOver: false
                };
                waitingPlayer.join(room);
                socket.join(room);

                const [player1, player2] = Math.random() < 0.5 ? ['black', 'white'] : ['white', 'black'];

                rooms[room].playersMap = {
                    [player1]: waitingPlayer.handshake.query.walletAddress,
                    [player2]: socket.handshake.query.walletAddress
                };

                io.to(waitingPlayer.id).emit('startGame', { room, player: player1 });
                io.to(socket.id).emit('startGame', { room, player: player2 });

                waitingPlayer = null;
                startTurnTimer(room, 'black');
                consumeChips(room);
            } else {
                waitingPlayer = socket;
            }
        });

        socket.on('makeMove', ({ room, x, y, player }) => {
            if (!rooms[room] || rooms[room].gameOver) return;
            if (rooms[room].currentPlayer === player) {
                rooms[room].board[y][x] = player;
                rooms[room].currentPlayer = player === 'black' ? 'white' : 'black';
                io.to(room).emit('moveMade', { x, y, player });
                startTurnTimer(room, rooms[room].currentPlayer);

                if (checkWin(x, y, player, room)) {
                    const winnerAddress = rooms[room].playersMap[player];
                    io.to(room).emit('gameOver', { winner: winnerAddress });
                    clearInterval(rooms[room].timerInterval);
                    rooms[room].gameOver = true;
                    closeRoom(room, 'Player won');
                    sendReward(winnerAddress);
                }
            }
        });

        socket.on('gameOver', ({ room, winner }) => {
            if (!rooms[room]) return;
            clearInterval(rooms[room].timerInterval);
            rooms[room].gameOver = true;
            io.to(room).emit('gameOver', { winner });
            const winnerAddress = rooms[room].playersMap[winner];
            rooms[room].players.forEach(id => io.sockets.sockets.get(id).leave(room));
            closeRoom(room, 'Game over');
            sendReward(winnerAddress);
        });

        socket.on('disconnect', () => {
            console.log('user disconnected');
            if (waitingPlayer && waitingPlayer.id === socket.id) {
                waitingPlayer = null;
            }
            for (let room in rooms) {
                const index = rooms[room].players.indexOf(socket.id);
                if (index !== -1) {
                    rooms[room].players.splice(index, 1);
                    const totalMoves = rooms[room].board.flat().filter(cell => cell !== null).length;
                    const remainingPlayer = rooms[room].players[0];
                    const remainingPlayerAddress = io.sockets.sockets.get(remainingPlayer)?.handshake.query.walletAddress;
                    if (remainingPlayerAddress) {
                        io.to(room).emit('opponentLeft', { totalMoves });
                        sendReward(remainingPlayerAddress);
                    }
                    if (rooms[room].players.length === 0 || rooms[room].gameOver) {
                        closeRoom(room, 'Player disconnected or game over');
                    }
                }
            }
        });

        const checkWin = (x, y, player, room) => {
            return (
                checkDirection(x, y, player, 1, 0, room) ||
                checkDirection(x, y, player, 0, 1, room) ||
                checkDirection(x, y, player, 1, 1, room) ||
                checkDirection(x, y, player, 1, -1, room)
            );
        };

        const checkDirection = (x, y, player, dx, dy, room) => {
            let count = 1;
            for (let i = 1; i < 5; i++) {
                if (rooms[room].board[y + i * dy]?.[x + i * dx] === player) {
                    count++;
                } else {
                    break;
                }
            }
            for (let i = 1; i < 5; i++) {
                if (rooms[room].board[y - i * dy]?.[x - i * dx] === player) {
                    count++;
                } else {
                    break;
                }
            }
            if (count === 5) {
                if (rooms[room].board[y + 5 * dy]?.[x + 5 * dx] === player || rooms[room].board[y - 5 * dy]?.[x - 5 * dx] === player) {
                    return false;
                }
                return true;
            }
            return false;
        };
    });

    server.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
} catch (err) {
    console.error('Error starting server:', err);
}

// 칩 구매 처리 엔드포인트
app.post('/buyChip', (req, res) => {
  const { walletAddress, txHash } = req.body;

  db.run("INSERT INTO users (wallet_address, chip_count) VALUES (?, ?) ON CONFLICT(wallet_address) DO UPDATE SET chip_count = chip_count + 1", [walletAddress, 1], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: 'Chip purchased successfully!' });
  });
});

// 사용자 칩 갯수 조회 엔드포인트
app.get('/chipCount', (req, res) => {
  const { walletAddress } = req.query;

  db.get("SELECT chip_count FROM users WHERE wallet_address = ?", [walletAddress], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ chipCount: row ? row.chip_count : 0 });
  });
});

// 서버 상태 확인 엔드포인트
app.get('/status', (req, res) => {
  res.json({ status: 'Server is running' });
});