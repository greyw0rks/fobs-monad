// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FobsRouter} from "../FobsRouter.sol";

/// @dev Minimal adapter mock: returns a fixed quote and emits nothing.
contract MockAdapter {
    uint256 public rate; // output per input, 1e18-scaled

    constructor(uint256 rate_) {
        rate = rate_;
    }

    function swapExactIn(
        address, /* tokenIn */
        address, /* tokenOut */
        uint256 amountIn,
        uint256, /* minAmountOut */
        address, /* recipient */
        bytes calldata /* data */
    ) external payable returns (uint256) {
        return (amountIn * rate) / 1e18;
    }
}

contract FobsRouterTest is Test {
    FobsRouter internal router;
    MockAdapter internal adapter;

    address internal trader = address(0xBEEF);
    address internal tokenOut = address(0xA11CE);

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

    function setUp() public {
        adapter = new MockAdapter(2e18); // 1 in -> 2 out
        router = new FobsRouter(address(adapter));
    }

    function test_ConstructorRejectsZeroAdapter() public {
        vm.expectRevert(FobsRouter.AdapterRequired.selector);
        new FobsRouter(address(0));
    }

    function test_SwapEmitsTradeExecuted() public {
        vm.deal(trader, 1 ether);
        vm.prank(trader);
        vm.expectEmit(true, true, false, true);
        emit TradeExecuted(trader, tokenOut, router.NATIVE(), 1 ether, 2 ether, trader, block.chainid, bytes32("r1"));
        uint256 out = router.swap{value: 1 ether}(router.NATIVE(), tokenOut, 1 ether, 2 ether, bytes32("r1"), "");
        assertEq(out, 2 ether);
    }

    function test_RevertsOnZeroAmount() public {
        vm.prank(trader);
        vm.expectRevert(FobsRouter.ZeroAmount.selector);
        router.swap(router.NATIVE(), tokenOut, 0, 0, bytes32("r1"), "");
    }

    function test_RevertsOnSlippage() public {
        vm.deal(trader, 1 ether);
        vm.prank(trader);
        // Demand 3 out for 1 in, but the adapter only yields 2 -> revert.
        vm.expectRevert(abi.encodeWithSelector(FobsRouter.SlippageExceeded.selector, 2 ether, 3 ether));
        router.swap{value: 1 ether}(router.NATIVE(), tokenOut, 1 ether, 3 ether, bytes32("r1"), "");
    }

    function test_ExecuteRouteCarriesSrcChain() public {
        vm.deal(trader, 1 ether);
        vm.prank(trader);
        vm.expectEmit(true, true, false, true);
        emit TradeExecuted(trader, tokenOut, router.NATIVE(), 1 ether, 2 ether, trader, 8453, bytes32("base-route"));
        router.executeRoute{value: 1 ether}(router.NATIVE(), tokenOut, 1 ether, 2 ether, trader, 8453, bytes32("base-route"), "");
    }
}
