// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";

contract FakeLucidao is ERC20Votes {
    uint256 public constant TOTAL_SUPPLY = 880000000e18;

    constructor() ERC20("Lucidao", "LCD") ERC20Permit("Lucidao") {
        _mint(_msgSender(), TOTAL_SUPPLY);
    }

    function _afterTokenTransfer(address from, address to, uint256 amount) internal override(ERC20Votes) {
        super._afterTokenTransfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal override(ERC20Votes) {
        super._mint(to, amount);
    }

    function _burn(address account, uint256 amount) internal override(ERC20Votes) {
        super._burn(account, amount);
    }
}
