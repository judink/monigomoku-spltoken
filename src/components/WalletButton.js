import React from 'react';

const WalletButton = ({ connectWallet }) => {
  return (
    <button onClick={connectWallet}>Connect to Phantom Wallet</button>
  );
};

export default WalletButton;
