# MegaSwap MCP Server

AI-native DEX interface for [MegaSwap](https://megaswap.xyz) on MegaETH. Enables AI agents to swap tokens, query prices, and manage liquidity via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io).

## Quick Start

```bash
npx megaswap-mcp
```

## Tools

| Tool | Description | Requires Key? |
|------|-------------|---------------|
| `megaswap_get_quote` | Get swap price quote | No |
| `megaswap_swap` | Execute token swap | Yes |
| `megaswap_get_pair` | Get pair reserves & price | No |
| `megaswap_list_pairs` | List all trading pairs | No |
| `megaswap_get_balance` | Check token/ETH balance | No |
| `megaswap_add_liquidity` | Add liquidity to pool | Yes |
| `megaswap_remove_liquidity` | Remove liquidity | Yes |
| `megaswap_list_tokens` | List known tokens | No |
| `megaswap_get_token_info` | Get token details | No |

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MEGASWAP_PRIVATE_KEY` | For swaps/liquidity | Wallet private key for signing transactions |
| `MEGASWAP_RPC_URL` | No | Custom RPC endpoint (default: `https://mainnet.megaeth.com/rpc`) |

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "megaswap": {
      "command": "npx",
      "args": ["-y", "megaswap-mcp"],
      "env": {
        "MEGASWAP_PRIVATE_KEY": "your-private-key-here"
      }
    }
  }
}
```

### Cursor / Windsurf

Add to MCP settings:

```json
{
  "megaswap": {
    "command": "npx",
    "args": ["-y", "megaswap-mcp"],
    "env": {
      "MEGASWAP_PRIVATE_KEY": "your-private-key-here"
    }
  }
}
```

## Supported Tokens

Built-in symbols: `ETH`, `WETH`, `MEGAS`, `USDM`, `USDT0`

Any ERC-20 token on MegaETH can be used by passing its contract address.

## Examples

**Get a swap quote:**
> "How much MEGAS can I get for 1 ETH on MegaSwap?"

**Execute a swap:**
> "Swap 0.5 ETH for MEGAS on MegaSwap with 2% slippage"

**Check liquidity:**
> "Show me the ETH/MEGAS pair info on MegaSwap"

**Add liquidity:**
> "Add 1 ETH and 1000 MEGAS as liquidity on MegaSwap"

## Network

- **Chain:** MegaETH (chainId: 4326)
- **DEX:** MegaSwap (Uniswap V2 fork)
- **Explorer:** https://megaeth.blockscout.com

## License

MIT
