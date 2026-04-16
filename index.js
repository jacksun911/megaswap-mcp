#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { ethers } from "ethers";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const RPC_URL = process.env.MEGASWAP_RPC_URL || "https://mainnet.megaeth.com/rpc";
const PRIVATE_KEY = process.env.MEGASWAP_PRIVATE_KEY || "";
const CHAIN_ID = 4326;

// Contract addresses — MegaETH mainnet
const ADDRESSES = {
  ROUTER: "0x283E75cA5489f4DF710D5c21F9d5cDd092d951D0",
  FACTORY: "0x793Baab191BB7c9F0cFe6ca0c5E70c8f2557Ba6c",
  WETH: "0x3B40190C616e756a577Df2B8D700922ce39E3849",
  MEGAS: "0x3E9608821b2D059a7a6b64CfE79d0F898727FaF5",
  MASTERCHEF: "0x9c7f674407886464762C4b7043f5ECf11E001B12",
  MEME_FACTORY: "0x0656893aF0894660420E3D125CfE9298a17De275",
};

// Well-known tokens for convenience
const KNOWN_TOKENS = {
  ETH: ADDRESSES.WETH,
  WETH: ADDRESSES.WETH,
  MEGAS: ADDRESSES.MEGAS,
  USDM: "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7",
  USDT0: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",
};

// ---------------------------------------------------------------------------
// Minimal ABIs (only functions we need)
// ---------------------------------------------------------------------------

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
  "function getAmountsIn(uint amountOut, address[] calldata path) external view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB, uint liquidity)",
  "function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)",
  "function removeLiquidity(address tokenA, address tokenB, uint liquidity, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB)",
  "function removeLiquidityETH(address token, uint liquidity, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external returns (uint amountToken, uint amountETH)",
  "function factory() external view returns (address)",
  "function WETH() external view returns (address)",
];

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
  "function allPairs(uint) external view returns (address pair)",
  "function allPairsLength() external view returns (uint)",
];

const PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function totalSupply() external view returns (uint)",
  "function balanceOf(address owner) external view returns (uint)",
  "function approve(address spender, uint value) external returns (bool)",
];

const ERC20_ABI = [
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
  "function totalSupply() external view returns (uint256)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 value) external returns (bool)",
];

// ---------------------------------------------------------------------------
// Provider & Contracts
// ---------------------------------------------------------------------------

const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);

function getRouter(signerOrProvider) {
  return new ethers.Contract(ADDRESSES.ROUTER, ROUTER_ABI, signerOrProvider);
}

function getFactory(signerOrProvider) {
  return new ethers.Contract(ADDRESSES.FACTORY, FACTORY_ABI, signerOrProvider);
}

function getPair(address, signerOrProvider) {
  return new ethers.Contract(address, PAIR_ABI, signerOrProvider);
}

function getERC20(address, signerOrProvider) {
  return new ethers.Contract(address, ERC20_ABI, signerOrProvider);
}

function getSigner() {
  if (!PRIVATE_KEY) {
    throw new Error("MEGASWAP_PRIVATE_KEY is required for write operations (swap, liquidity). Set it as an environment variable.");
  }
  return new ethers.Wallet(PRIVATE_KEY, provider);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve token symbol or address to a checksum address. */
function resolveToken(tokenInput) {
  const upper = tokenInput.toUpperCase();
  if (KNOWN_TOKENS[upper]) return KNOWN_TOKENS[upper];
  if (ethers.isAddress(tokenInput)) return ethers.getAddress(tokenInput);
  throw new Error(`Unknown token: "${tokenInput}". Use a contract address or one of: ${Object.keys(KNOWN_TOKENS).join(", ")}`);
}

/** Format a bigint token amount to human-readable with given decimals. */
function formatUnits(amount, decimals) {
  return ethers.formatUnits(amount, decimals);
}

/** Parse a human-readable amount to bigint with given decimals. */
function parseUnits(amount, decimals) {
  return ethers.parseUnits(String(amount), decimals);
}

/** Default deadline: 20 minutes from now. */
function deadline() {
  return Math.floor(Date.now() / 1000) + 1200;
}

/** Get token metadata. */
async function getTokenInfo(address) {
  if (address.toLowerCase() === ADDRESSES.WETH.toLowerCase()) {
    return { address, symbol: "WETH", name: "Wrapped Ether", decimals: 18 };
  }
  const token = getERC20(address, provider);
  const [name, symbol, decimals] = await Promise.all([
    token.name(),
    token.symbol(),
    token.decimals(),
  ]);
  return { address, symbol, name, decimals: Number(decimals) };
}

function jsonResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(err) {
  return {
    content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "megaswap",
  version: "1.0.0",
  description:
    "MegaSwap — AI-native DEX on MegaETH. Swap tokens, manage liquidity, and query prices programmatically via MCP.",
});

// ---------------------------------------------------------------------------
// Tool: megaswap_get_quote
// ---------------------------------------------------------------------------

server.registerTool("megaswap_get_quote", {
  description:
    "Get a swap price quote. Returns the expected output amount for a given input. No wallet or private key needed.",
  inputSchema: {
    tokenIn: z.string().describe('Input token (address or symbol: ETH, WETH, MEGAS, USDM, USDT0)'),
    tokenOut: z.string().describe('Output token (address or symbol)'),
    amountIn: z.string().describe('Amount of input token (human-readable, e.g. "1.5")'),
  },
}, async ({ tokenIn, tokenOut, amountIn }) => {
  try {
    const addrIn = resolveToken(tokenIn);
    const addrOut = resolveToken(tokenOut);
    const infoIn = await getTokenInfo(addrIn);
    const infoOut = await getTokenInfo(addrOut);

    const amountInWei = parseUnits(amountIn, infoIn.decimals);
    const path = [addrIn, addrOut];

    const router = getRouter(provider);
    const amounts = await router.getAmountsOut(amountInWei, path);

    const amountOutHuman = formatUnits(amounts[1], infoOut.decimals);
    const price = parseFloat(amountOutHuman) / parseFloat(amountIn);

    return jsonResult({
      tokenIn: { ...infoIn, amount: amountIn },
      tokenOut: { ...infoOut, amount: amountOutHuman },
      price: `1 ${infoIn.symbol} = ${price.toFixed(6)} ${infoOut.symbol}`,
      path: path,
      amountInWei: amounts[0].toString(),
      amountOutWei: amounts[1].toString(),
    });
  } catch (err) {
    return errorResult(err);
  }
});

// ---------------------------------------------------------------------------
// Tool: megaswap_swap
// ---------------------------------------------------------------------------

server.registerTool("megaswap_swap", {
  description:
    "Execute a token swap on MegaSwap. Requires MEGASWAP_PRIVATE_KEY env var. Supports ETH↔Token and Token↔Token swaps.",
  inputSchema: {
    tokenIn: z.string().describe('Input token (address or symbol: ETH, WETH, MEGAS, USDM, USDT0)'),
    tokenOut: z.string().describe('Output token (address or symbol)'),
    amountIn: z.string().describe('Amount of input token (human-readable, e.g. "1.5")'),
    slippagePercent: z.number().min(0).max(50).optional().describe("Slippage tolerance in percent (default: 1)"),
  },
}, async ({ tokenIn, tokenOut, amountIn, slippagePercent }) => {
  try {
    const signer = getSigner();
    const signerAddress = await signer.getAddress();
    const slippage = slippagePercent ?? 1;

    const addrIn = resolveToken(tokenIn);
    const addrOut = resolveToken(tokenOut);
    const infoIn = await getTokenInfo(addrIn);
    const infoOut = await getTokenInfo(addrOut);

    const amountInWei = parseUnits(amountIn, infoIn.decimals);
    const isETHIn = tokenIn.toUpperCase() === "ETH";
    const isETHOut = tokenOut.toUpperCase() === "ETH";

    const router = getRouter(signer);
    const path = [addrIn, addrOut];
    const amounts = await router.getAmountsOut(amountInWei, path);
    const amountOutMin = amounts[1] * BigInt(Math.floor((100 - slippage) * 10)) / 1000n;

    let tx;

    if (isETHIn) {
      // ETH → Token
      tx = await router.swapExactETHForTokens(
        amountOutMin, [ADDRESSES.WETH, addrOut], signerAddress, deadline(),
        { value: amountInWei }
      );
    } else if (isETHOut) {
      // Token → ETH: approve first
      const tokenContract = getERC20(addrIn, signer);
      const allowance = await tokenContract.allowance(signerAddress, ADDRESSES.ROUTER);
      if (allowance < amountInWei) {
        const approveTx = await tokenContract.approve(ADDRESSES.ROUTER, ethers.MaxUint256);
        await approveTx.wait();
      }
      tx = await router.swapExactTokensForETH(
        amountInWei, amountOutMin, [addrIn, ADDRESSES.WETH], signerAddress, deadline()
      );
    } else {
      // Token → Token: approve first
      const tokenContract = getERC20(addrIn, signer);
      const allowance = await tokenContract.allowance(signerAddress, ADDRESSES.ROUTER);
      if (allowance < amountInWei) {
        const approveTx = await tokenContract.approve(ADDRESSES.ROUTER, ethers.MaxUint256);
        await approveTx.wait();
      }
      tx = await router.swapExactTokensForTokens(
        amountInWei, amountOutMin, path, signerAddress, deadline()
      );
    }

    const receipt = await tx.wait();

    return jsonResult({
      status: "success",
      txHash: receipt.hash,
      from: signerAddress,
      tokenIn: { symbol: infoIn.symbol, amount: amountIn },
      tokenOut: { symbol: infoOut.symbol, expectedAmount: formatUnits(amounts[1], infoOut.decimals) },
      slippage: `${slippage}%`,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      explorerUrl: `https://megaeth.blockscout.com/tx/${receipt.hash}`,
    });
  } catch (err) {
    return errorResult(err);
  }
});

// ---------------------------------------------------------------------------
// Tool: megaswap_get_pair
// ---------------------------------------------------------------------------

server.registerTool("megaswap_get_pair", {
  description:
    "Get detailed info about a trading pair: reserves, price, TVL. No wallet needed.",
  inputSchema: {
    tokenA: z.string().describe('First token (address or symbol)'),
    tokenB: z.string().describe('Second token (address or symbol)'),
  },
}, async ({ tokenA, tokenB }) => {
  try {
    const addrA = resolveToken(tokenA);
    const addrB = resolveToken(tokenB);

    const factory = getFactory(provider);
    const pairAddress = await factory.getPair(addrA, addrB);

    if (pairAddress === ethers.ZeroAddress) {
      return jsonResult({ exists: false, message: `No pair found for ${tokenA}/${tokenB}` });
    }

    const pair = getPair(pairAddress, provider);
    const [reserves, token0Addr, token1Addr, totalSupply] = await Promise.all([
      pair.getReserves(),
      pair.token0(),
      pair.token1(),
      pair.totalSupply(),
    ]);

    const [info0, info1] = await Promise.all([
      getTokenInfo(token0Addr),
      getTokenInfo(token1Addr),
    ]);

    const reserve0Human = formatUnits(reserves[0], info0.decimals);
    const reserve1Human = formatUnits(reserves[1], info1.decimals);

    const price0in1 = parseFloat(reserve1Human) / parseFloat(reserve0Human);
    const price1in0 = parseFloat(reserve0Human) / parseFloat(reserve1Human);

    return jsonResult({
      pairAddress,
      token0: { ...info0, reserve: reserve0Human },
      token1: { ...info1, reserve: reserve1Human },
      price: {
        [`${info0.symbol}_per_${info1.symbol}`]: price1in0.toFixed(6),
        [`${info1.symbol}_per_${info0.symbol}`]: price0in1.toFixed(6),
      },
      totalLPSupply: formatUnits(totalSupply, 18),
      explorerUrl: `https://megaeth.blockscout.com/address/${pairAddress}`,
    });
  } catch (err) {
    return errorResult(err);
  }
});

// ---------------------------------------------------------------------------
// Tool: megaswap_list_pairs
// ---------------------------------------------------------------------------

server.registerTool("megaswap_list_pairs", {
  description:
    "List trading pairs on MegaSwap. Returns pair addresses with token symbols.",
  inputSchema: {
    limit: z.number().int().min(1).max(50).optional().describe("Max pairs to return (default: 20)"),
    offset: z.number().int().min(0).optional().describe("Starting index (default: 0)"),
  },
}, async ({ limit, offset }) => {
  try {
    const factory = getFactory(provider);
    const totalPairs = Number(await factory.allPairsLength());
    const start = offset ?? 0;
    const count = Math.min(limit ?? 20, totalPairs - start);

    if (count <= 0) {
      return jsonResult({ totalPairs, pairs: [], message: "No more pairs" });
    }

    const pairPromises = [];
    for (let i = start; i < start + count; i++) {
      pairPromises.push(
        (async (idx) => {
          const pairAddr = await factory.allPairs(idx);
          const pair = getPair(pairAddr, provider);
          const [t0Addr, t1Addr] = await Promise.all([pair.token0(), pair.token1()]);
          const [info0, info1] = await Promise.all([getTokenInfo(t0Addr), getTokenInfo(t1Addr)]);
          return {
            index: idx,
            pairAddress: pairAddr,
            token0: { address: info0.address, symbol: info0.symbol },
            token1: { address: info1.address, symbol: info1.symbol },
          };
        })(i)
      );
    }

    const pairs = await Promise.all(pairPromises);

    return jsonResult({ totalPairs, showing: { from: start, to: start + count - 1 }, pairs });
  } catch (err) {
    return errorResult(err);
  }
});

// ---------------------------------------------------------------------------
// Tool: megaswap_get_balance
// ---------------------------------------------------------------------------

server.registerTool("megaswap_get_balance", {
  description:
    "Check token balance for any address. Also returns ETH balance.",
  inputSchema: {
    address: z.string().optional().describe("Wallet address to check (defaults to signer wallet if MEGASWAP_PRIVATE_KEY is set)"),
    token: z.string().optional().describe("Token to check (address or symbol). Omit for ETH balance only."),
  },
}, async ({ address, token }) => {
  try {
    let walletAddress;
    if (address) {
      walletAddress = ethers.getAddress(address);
    } else if (PRIVATE_KEY) {
      walletAddress = new ethers.Wallet(PRIVATE_KEY).address;
    } else {
      throw new Error("Provide an address or set MEGASWAP_PRIVATE_KEY");
    }

    const ethBalance = await provider.getBalance(walletAddress);
    const result = {
      address: walletAddress,
      ethBalance: formatUnits(ethBalance, 18),
    };

    if (token) {
      const tokenAddr = resolveToken(token);
      const info = await getTokenInfo(tokenAddr);
      const tokenContract = getERC20(tokenAddr, provider);
      const balance = await tokenContract.balanceOf(walletAddress);
      result.token = {
        ...info,
        balance: formatUnits(balance, info.decimals),
      };
    }

    return jsonResult(result);
  } catch (err) {
    return errorResult(err);
  }
});

// ---------------------------------------------------------------------------
// Tool: megaswap_add_liquidity
// ---------------------------------------------------------------------------

server.registerTool("megaswap_add_liquidity", {
  description:
    "Add liquidity to a MegaSwap pool. Requires MEGASWAP_PRIVATE_KEY. Supports ETH+Token and Token+Token pairs.",
  inputSchema: {
    tokenA: z.string().describe('First token (address or symbol, use "ETH" for native ETH)'),
    tokenB: z.string().describe('Second token (address or symbol)'),
    amountA: z.string().describe('Desired amount of tokenA (human-readable)'),
    amountB: z.string().describe('Desired amount of tokenB (human-readable)'),
    slippagePercent: z.number().min(0).max(50).optional().describe("Slippage tolerance in percent (default: 5)"),
  },
}, async ({ tokenA, tokenB, amountA, amountB, slippagePercent }) => {
  try {
    const signer = getSigner();
    const signerAddress = await signer.getAddress();
    const slippage = slippagePercent ?? 5;
    const router = getRouter(signer);

    const isETHA = tokenA.toUpperCase() === "ETH";
    const isETHB = tokenB.toUpperCase() === "ETH";

    if (isETHA && isETHB) throw new Error("Cannot add liquidity with ETH on both sides");

    let tx;

    if (isETHA || isETHB) {
      // ETH + Token liquidity
      const ethSide = isETHA ? amountA : amountB;
      const tokenSide = isETHA ? tokenB : tokenA;
      const tokenAmount = isETHA ? amountB : amountA;

      const tokenAddr = resolveToken(tokenSide);
      const tokenInfo = await getTokenInfo(tokenAddr);

      const ethWei = parseUnits(ethSide, 18);
      const tokenWei = parseUnits(tokenAmount, tokenInfo.decimals);

      // Approve token
      const tokenContract = getERC20(tokenAddr, signer);
      const allowance = await tokenContract.allowance(signerAddress, ADDRESSES.ROUTER);
      if (allowance < tokenWei) {
        const appTx = await tokenContract.approve(ADDRESSES.ROUTER, ethers.MaxUint256);
        await appTx.wait();
      }

      const minToken = tokenWei * BigInt(Math.floor((100 - slippage) * 10)) / 1000n;
      const minETH = ethWei * BigInt(Math.floor((100 - slippage) * 10)) / 1000n;

      tx = await router.addLiquidityETH(
        tokenAddr, tokenWei, minToken, minETH, signerAddress, deadline(),
        { value: ethWei }
      );
    } else {
      // Token + Token liquidity
      const addrA = resolveToken(tokenA);
      const addrB = resolveToken(tokenB);
      const [infoA, infoB] = await Promise.all([getTokenInfo(addrA), getTokenInfo(addrB)]);

      const amountAWei = parseUnits(amountA, infoA.decimals);
      const amountBWei = parseUnits(amountB, infoB.decimals);

      // Approve both tokens
      for (const [addr, amount] of [[addrA, amountAWei], [addrB, amountBWei]]) {
        const tc = getERC20(addr, signer);
        const allowance = await tc.allowance(signerAddress, ADDRESSES.ROUTER);
        if (allowance < amount) {
          const appTx = await tc.approve(ADDRESSES.ROUTER, ethers.MaxUint256);
          await appTx.wait();
        }
      }

      const minA = amountAWei * BigInt(Math.floor((100 - slippage) * 10)) / 1000n;
      const minB = amountBWei * BigInt(Math.floor((100 - slippage) * 10)) / 1000n;

      tx = await router.addLiquidity(
        addrA, addrB, amountAWei, amountBWei, minA, minB, signerAddress, deadline()
      );
    }

    const receipt = await tx.wait();

    return jsonResult({
      status: "success",
      txHash: receipt.hash,
      from: signerAddress,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      explorerUrl: `https://megaeth.blockscout.com/tx/${receipt.hash}`,
    });
  } catch (err) {
    return errorResult(err);
  }
});

// ---------------------------------------------------------------------------
// Tool: megaswap_remove_liquidity
// ---------------------------------------------------------------------------

server.registerTool("megaswap_remove_liquidity", {
  description:
    "Remove liquidity from a MegaSwap pool. Requires MEGASWAP_PRIVATE_KEY.",
  inputSchema: {
    tokenA: z.string().describe('First token (address or symbol, use "ETH" for native ETH)'),
    tokenB: z.string().describe('Second token (address or symbol)'),
    lpAmount: z.string().describe('Amount of LP tokens to remove (human-readable)'),
    slippagePercent: z.number().min(0).max(50).optional().describe("Slippage tolerance in percent (default: 5)"),
  },
}, async ({ tokenA, tokenB, lpAmount, slippagePercent }) => {
  try {
    const signer = getSigner();
    const signerAddress = await signer.getAddress();
    const slippage = slippagePercent ?? 5;
    const router = getRouter(signer);

    const isETHA = tokenA.toUpperCase() === "ETH";
    const isETHB = tokenB.toUpperCase() === "ETH";

    const addrA = resolveToken(tokenA);
    const addrB = resolveToken(tokenB);

    // Get pair and approve LP
    const factory = getFactory(provider);
    const pairAddress = await factory.getPair(addrA, addrB);
    if (pairAddress === ethers.ZeroAddress) throw new Error("Pair not found");

    const pair = getPair(pairAddress, signer);
    const lpWei = parseUnits(lpAmount, 18);

    const allowance = await pair.allowance(signerAddress, ADDRESSES.ROUTER);
    if (allowance < lpWei) {
      const appTx = await pair.approve(ADDRESSES.ROUTER, ethers.MaxUint256);
      await appTx.wait();
    }

    // Estimate output amounts from reserves
    const [reserves, token0Addr, totalSupply] = await Promise.all([
      pair.getReserves(),
      pair.token0(),
      pair.totalSupply(),
    ]);

    const share = (lpWei * 10000n) / totalSupply;
    const estAmount0 = (reserves[0] * share) / 10000n;
    const estAmount1 = (reserves[1] * share) / 10000n;
    const slippageFactor = BigInt(Math.floor((100 - slippage) * 10));
    const minAmount0 = (estAmount0 * slippageFactor) / 1000n;
    const minAmount1 = (estAmount1 * slippageFactor) / 1000n;

    // Order minimums by token0/token1
    const isAToken0 = addrA.toLowerCase() === token0Addr.toLowerCase();
    const minA = isAToken0 ? minAmount0 : minAmount1;
    const minB = isAToken0 ? minAmount1 : minAmount0;

    let tx;
    if (isETHA || isETHB) {
      const tokenAddr = isETHA ? addrB : addrA;
      const minToken = isETHA ? minB : minA;
      const minETH = isETHA ? minA : minB;
      tx = await router.removeLiquidityETH(
        tokenAddr, lpWei, minToken, minETH, signerAddress, deadline()
      );
    } else {
      tx = await router.removeLiquidity(
        addrA, addrB, lpWei, minA, minB, signerAddress, deadline()
      );
    }

    const receipt = await tx.wait();

    return jsonResult({
      status: "success",
      txHash: receipt.hash,
      from: signerAddress,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      explorerUrl: `https://megaeth.blockscout.com/tx/${receipt.hash}`,
    });
  } catch (err) {
    return errorResult(err);
  }
});

// ---------------------------------------------------------------------------
// Tool: megaswap_list_tokens
// ---------------------------------------------------------------------------

server.registerTool("megaswap_list_tokens", {
  description:
    "List well-known tokens on MegaSwap with their addresses and basic info.",
}, async () => {
  try {
    const tokens = await Promise.all(
      Object.entries(KNOWN_TOKENS)
        .filter(([sym], i, arr) => {
          // Deduplicate ETH/WETH (same address)
          if (sym === "WETH") return true;
          if (sym === "ETH") return false;
          return true;
        })
        .map(async ([sym, addr]) => {
          const info = await getTokenInfo(addr);
          return { symbol: sym === "WETH" ? "ETH/WETH" : info.symbol, name: info.name, address: addr, decimals: info.decimals };
        })
    );

    return jsonResult({
      network: "MegaETH (chainId: 4326)",
      rpc: RPC_URL,
      dex: "MegaSwap",
      tokens,
      note: "Use ETH for native Ether swaps. All other tokens require their address or known symbol.",
    });
  } catch (err) {
    return errorResult(err);
  }
});

// ---------------------------------------------------------------------------
// Tool: megaswap_get_token_info
// ---------------------------------------------------------------------------

server.registerTool("megaswap_get_token_info", {
  description:
    "Get detailed info about a token: name, symbol, decimals, total supply.",
  inputSchema: {
    token: z.string().describe("Token address or known symbol (ETH, MEGAS, USDM, USDT0)"),
  },
}, async ({ token }) => {
  try {
    const addr = resolveToken(token);
    const info = await getTokenInfo(addr);
    const tokenContract = getERC20(addr, provider);
    const totalSupply = await tokenContract.totalSupply();

    return jsonResult({
      ...info,
      totalSupply: formatUnits(totalSupply, info.decimals),
    });
  } catch (err) {
    return errorResult(err);
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server fatal error:", err);
  process.exit(1);
});
