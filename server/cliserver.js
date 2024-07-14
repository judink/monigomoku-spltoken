const express = require('express');
const bodyParser = require('body-parser');
const { exec } = require('child_process');

const app = express();
const PORT = 4000;

app.use(bodyParser.json());

let rewardQueue = [];

const processQueue = () => {
  if (rewardQueue.length === 0) return;

  const { winnerAddress } = rewardQueue.shift();
  const command = `spl-token transfer C3YcZRDATeGZSpkvGryJ7uoyYhD8gxrGei4pVwdcDXx8 18 ${winnerAddress}`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error executing command: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`stderr: ${stderr}`);
      return;
    }
    console.log(`stdout: ${stdout}`);
    console.log(`Reward sent to ${winnerAddress}`);
    // 다시 큐를 처리하도록 호출
    processQueue();
  });
};

app.post('/sendReward', (req, res) => {
  const { winner } = req.body;

  if (!winner) {
    return res.status(400).json({ error: 'Winner address is required' });
  }

  rewardQueue.push({ winnerAddress: winner });
  console.log(`Reward request added for ${winner}`);

  if (rewardQueue.length === 1) {
    processQueue();
  }

  res.json({ message: 'Reward request received' });
});

app.listen(PORT, () => {
  console.log(`CLI Server is running on port ${PORT}`);
});