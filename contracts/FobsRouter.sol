// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FobsRouter
/// @notice Minimal settlement router for the Fobs social trading terminal on
///         Monad. It is intentionally NOT a DEX, AMM, or bridge: it swaps
///         through an external aggregator/adapter and emits a single canonical
///         `TradeExecuted` event that the Fobs indexer treats as the activity
///         graph's source of truth. Cross-chain funding is handled off-chain by
///         a LI.FI-style route engine; by the time funds reach this contract on
///         Monad, the trade is a local swap.
///
/// @dev    Reference artifact for the demo build. The app simulates execution
///         server-side (no funds move), so this is not deployed on the critical
///         path — but the ABI and `TradeExecuted` shape are what a live indexer
///         would consume. Keep this file dependency-free so `forge build` /
///         `forge test` work without remappings.
interface ISwapAdapter {
    /// @notice Execute a swap of `amountIn` of `tokenIn` for at least
    ///         `minAmountOut` of `tokenOut`, delivering output to `recipient`.
    function swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        bytes calldata data
    ) external payable returns (uint256 amountOut);
}

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract FobsRouter {
    /// @notice Native-token sentinel (MON) used in place of an ERC20 address.
    address public constant NATIVE = address(0);

    /// @notice The whitelisted swap adapter (an aggregator wrapper).
    ISwapAdapter public immutable adapter;

    /// @notice Canonical trade event — the one signal the Fobs indexer reads.
    /// @param trader       The wallet whose identity owns the trade (Fobs User).
    /// @param tokenIn      Input token (NATIVE for MON).
    /// @param tokenOut     Output token the trader ends up holding.
    /// @param amountIn     Input amount (in tokenIn units).
    /// @param amountOut    Output amount actually received.
    /// @param recipient    Who received the output (trader, or a 3rd party for swapAndSend).
    /// @param srcChainId   Chain the funding originated on (same as block.chainid for a pure Monad swap).
    /// @param routeId      Opaque id tying this fill back to the off-chain route quote.
    event TradeExecuted(
        address indexed trader,
        address indexed tokenOut,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOut,
        address recipient,
        uint256 srcChainId,
        bytes32 routeId
    );

    error ZeroAmount();
    error SlippageExceeded(uint256 got, uint256 min);
    error AdapterRequired();

    constructor(address adapter_) {
        if (adapter_ == address(0)) revert AdapterRequired();
        adapter = ISwapAdapter(adapter_);
    }

    /// @notice Swap `amountIn` of `tokenIn` into `tokenOut` for the caller.
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes32 routeId,
        bytes calldata adapterData
    ) external payable returns (uint256 amountOut) {
        return _execute(msg.sender, tokenIn, tokenOut, amountIn, minAmountOut, msg.sender, block.chainid, routeId, adapterData);
    }

    /// @notice Swap and deliver the output to a different `recipient`.
    function swapAndSend(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        bytes32 routeId,
        bytes calldata adapterData
    ) external payable returns (uint256 amountOut) {
        return _execute(msg.sender, tokenIn, tokenOut, amountIn, minAmountOut, recipient, block.chainid, routeId, adapterData);
    }

    /// @notice Settle a cross-chain route whose funding originated on `srcChainId`.
    ///         The bridge leg is handled upstream; this is the final Monad swap.
    function executeRoute(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        uint256 srcChainId,
        bytes32 routeId,
        bytes calldata adapterData
    ) external payable returns (uint256 amountOut) {
        return _execute(msg.sender, tokenIn, tokenOut, amountIn, minAmountOut, recipient, srcChainId, routeId, adapterData);
    }

    function _execute(
        address trader,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        uint256 srcChainId,
        bytes32 routeId,
        bytes calldata adapterData
    ) internal returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();

        uint256 value;
        if (tokenIn == NATIVE) {
            value = amountIn; // forwarded MON
        } else {
            // Pull ERC20 input from the trader and approve the adapter.
            IERC20(tokenIn).transferFrom(trader, address(this), amountIn);
            IERC20(tokenIn).approve(address(adapter), amountIn);
        }

        amountOut = adapter.swapExactIn{value: value}(tokenIn, tokenOut, amountIn, minAmountOut, recipient, adapterData);
        if (amountOut < minAmountOut) revert SlippageExceeded(amountOut, minAmountOut);

        emit TradeExecuted(trader, tokenOut, tokenIn, amountIn, amountOut, recipient, srcChainId, routeId);
    }
}
