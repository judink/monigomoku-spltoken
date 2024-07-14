import React, { useEffect, useState } from 'react';
import { initializeParticipant, getGameChip } from './solana';
import WalletButton from './components/WalletButton';
import GameBoard from './components/GameBoard';
import './App.css';

function App() {
  const [chipCount, setChipCount] = useState(null);
  const [walletConnected, setWalletConnected] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [walletAddress, setWalletAddress] = useState(null);
  const [inGame, setInGame] = useState(false);

  const isPhantomInstalled = () => {
    return window.solana && window.solana.isPhantom;
  };

  const connectWallet = async () => {
    if (isPhantomInstalled()) {
      try {
        const resp = await window.solana.connect();
        console.log('Connected with public key:', resp.publicKey.toString());
        setWalletAddress(resp.publicKey.toString());
        setWalletConnected(true);
        await initializeParticipant();
        await updateChipCount(resp.publicKey.toString());
      } catch (err) {
        console.error('Error connecting to Phantom Wallet:', err);
      }
    } else {
      alert('Phantom Wallet not found. Please install it.');
    }
  };

  const handleBuyChip = async () => {
    try {
      const serverStatus = await fetch('https://moniomok.xyz:3001/status');
      if (!serverStatus.ok) {
        throw new Error('Server is not running');
      }

      const txHash = await getGameChip();
      console.log(`Chip purchase transaction hash: ${txHash}`);
      await updateChipCount(walletAddress);
      setShowModal(false);
    } catch (err) {
      console.error('Error buying chip:', err);
      alert('Error buying chip: ' + err.message);
    }
  };

  const updateChipCount = async (walletAddress) => {
    try {
      const response = await fetch(`https://moniomok.xyz:3001/chipCount?walletAddress=${walletAddress}`);
      const data = await response.json();
      setChipCount(data.chipCount);
    } catch (err) {
      console.error('Error fetching chip count:', err);
    }
  };

  useEffect(() => {
    if (walletConnected) {
      updateChipCount(walletAddress);
    }
  }, [walletConnected, walletAddress]);

  return (
    <div className="App" style={{ backgroundImage: `url(${process.env.PUBLIC_URL + '/background.png'})` }}>
      <header className="App-header">
        <h1>Moni Gomoku</h1>
        {walletConnected ? (
          <>
            <p className="wallet-address">Connected wallet address: {walletAddress}</p>
            <p>Chips: {chipCount !== null ? chipCount : 'Loading...'}</p>
            <button onClick={() => setShowModal(true)}>Buy Chips</button>
            <GameBoard walletAddress={walletAddress} setInGame={setInGame} chipsAvailable={chipCount > 0} />
          </>
        ) : (
          <WalletButton connectWallet={connectWallet} />
        )}
      </header>
      {showModal && (
        <div className="modal">
          <div className="modal-content">
            <h2>칩 구매 확인</h2>
            <p>정말로 칩을 구매하시겠습니까?</p>
            <button onClick={handleBuyChip}>확인</button>
            <button onClick={() => setShowModal(false)}>취소</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
