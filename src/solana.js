import * as anchor from '@project-serum/anchor';
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js';
import idl from './idl.json';
import { Buffer } from 'buffer';
import {
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
  getAccount
} from "@solana/spl-token";

const programId = new PublicKey("7THwydBy1WnPVuqHtwKqX86t5eioqmwXcyrKzEDDAwfP");

const getProvider = () => {
  if (!window.solana) {
    throw new Error("Solana 객체를 찾을 수 없습니다! Phantom Wallet을 설치하세요 👻");
  }

  const connection = new Connection('https://api.devnet.solana.com', 'processed');
  const wallet = window.solana;
  return new anchor.AnchorProvider(connection, wallet, anchor.AnchorProvider.defaultOptions());
};

const getProgram = () => {
  const provider = getProvider();
  return new anchor.Program(idl, programId, provider);
};

export const initializeParticipant = async () => {
  const program = getProgram();
  const player = program.provider.wallet.publicKey;
  const [participantPDA] = await PublicKey.findProgramAddress(
    [Buffer.from("participant"), player.toBuffer()],
    program.programId
  );

  try {
    await program.account.participant.fetch(participantPDA);
    console.log("참가자 계정이 이미 존재합니다");
  } catch (e) {
    console.log("참가자 계정 초기화 중...");
    const txHash = await program.methods.initializeParticipant()
      .accounts({
        player: player,
        participant: participantPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`참가자 초기화 완료, 서명: ${txHash}`);
    await program.provider.connection.confirmTransaction(txHash);
  }
};

export const getGameChip = async () => {
  const program = getProgram();
  const player = program.provider.wallet.publicKey;
  const gameOwner = new PublicKey("J4g4Qg8vRMKHymSyhaKU5o2KcJsyMeWCEZYNuguMxmki");
  const mint = new PublicKey("C3YcZRDATeGZSpkvGryJ7uoyYhD8gxrGei4pVwdcDXx8");

  // 게임 토큰 계정 가져오기 또는 생성
  let gameTokenAccount;
  try {
    const tokenAccounts = await program.provider.connection.getParsedTokenAccountsByOwner(
      gameOwner,
      { mint }
    );
    if (tokenAccounts.value.length === 0) {
      gameTokenAccount = await getOrCreateAssociatedTokenAccount(
        program.provider.connection,
        program.provider.wallet.payer,
        mint,
        gameOwner
      );
    } else {
      gameTokenAccount = tokenAccounts.value[0].pubkey;
    }
  } catch (err) {
    console.error("게임 토큰 계정을 찾거나 생성하는 중 오류 발생:", err);
    throw new Error("게임 토큰 계정을 찾거나 생성할 수 없습니다.");
  }

  // 플레이어 토큰 계정 가져오기 또는 생성
  let playerTokenAccount;
  let playerTokenAccountInfo;
  try {
    playerTokenAccount = await getOrCreateAssociatedTokenAccount(
      program.provider.connection,
      program.provider.wallet.payer,
      mint,
      player
    );
    console.log("플레이어 토큰 계정 생성 또는 찾기 성공:", playerTokenAccount.address ? playerTokenAccount.address.toBase58() : playerTokenAccount.toBase58());

    // 토큰 잔액 확인
    playerTokenAccountInfo = await getAccount(program.provider.connection, playerTokenAccount.address ? playerTokenAccount.address : playerTokenAccount);
    const playerTokenAmount = playerTokenAccountInfo.amount.toString();
    if (parseInt(playerTokenAmount) === 0) {
      console.error("플레이어의 토큰 잔액이 없습니다.");
      throw new Error("플레이어의 토큰 잔액이 없습니다.");
    }
  } catch (err) {
    console.error("플레이어 토큰 계정을 가져오거나 생성하는 중 오류 발생:", err);
    throw new Error("플레이어 토큰 계정을 가져오거나 생성할 수 없습니다.");
  }

  // 참가자 PDA 정의
  const [participantPDA] = await PublicKey.findProgramAddress(
    [Buffer.from("participant"), player.toBuffer()],
    program.programId
  );

  // 칩 구매 트랜잭션
  const amount = new anchor.BN(10000000000);  // 10 SPL Token (assuming 9 decimals)
  try {
    const txHash = await program.methods.getGameChip(amount)
      .accounts({
        player: player,
        playerTokenAccount: playerTokenAccount.address ? playerTokenAccount.address : playerTokenAccount,
        gameTokenAccount: gameTokenAccount,
        participant: participantPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`트랜잭션 확인, 서명: ${txHash}`);
    await program.provider.connection.confirmTransaction(txHash);

    const txDetails = await program.provider.connection.getConfirmedTransaction(txHash, 'confirmed');
    console.log("트랜잭션 세부 정보:", txDetails);

    // 토큰 이전 확인
    const preTokenBalance = txDetails.meta.preTokenBalances.find(
      balance => balance.owner === player.toString() && balance.mint === mint.toString()
    );

    const postTokenBalance = txDetails.meta.postTokenBalances.find(
      balance => balance.owner === player.toString() && balance.mint === mint.toString()
    );

    if (!preTokenBalance || !postTokenBalance) {
      throw new Error('Could not find token balances in transaction details.');
    }

    const preBalance = parseInt(preTokenBalance.uiTokenAmount.amount);
    const postBalance = parseInt(postTokenBalance.uiTokenAmount.amount);

    // 1. 트랜잭션을 생성하기 전의 사용자의 토큰 갯수와 트랜잭션 로그의 이전 사용자 토큰 갯수를 비교
    if (parseInt(playerTokenAccountInfo.amount.toString()) === preBalance &&
        // 2. 트랜잭션 로그의 pre 토큰갯수와 post 토큰갯수 차이
        preBalance - postBalance >= amount.toNumber()) {
      console.log('토큰이 성공적으로 전송되었습니다.');
      const response = await fetch('https://moniomok.xyz:3001/buyChip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ walletAddress: player.toString(), txHash })
      });

      if (!response.ok) {
        throw new Error('Chip purchase failed');
      }

      return txHash;
    } else {
      throw new Error('Transfer amount mismatch or not found.');
    }
  } catch (err) {
    console.error("칩 구매 트랜잭션 중 오류 발생:", err);
    throw new Error("칩 구매 트랜잭션을 완료할 수 없습니다.");
  }
};
