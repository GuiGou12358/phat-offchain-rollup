import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("RollupAnchor", function () {
  async function deployFixture() {
    // Contracts are deployed using the first signer/account by default
    const [owner, submitter, submitter2] = await ethers.getSigners();

    const TestReceiver = await ethers.getContractFactory("TestReceiver");
    const target = await TestReceiver.deploy(submitter.address);
    return { target, owner, submitter, submitter2 };
  }

  // describe("Deployment", function () {
  //   it("Should set the right unlockTime", async function () {
  //     const { anchor, receiver } = await loadFixture(deployFixture);
  //   });

  //   it("Should get the constant calcuated", async function () {
  //     const { anchor } = await loadFixture(deployFixture);
  //     expect(await anchor.genReceiverSelector()).to.equal("0x43a53d89");
  //   })

  //   it("Should convert bytes to uint256", async function () {
  //     const { anchor } = await loadFixture(deployFixture);
  //     expect(await anchor.testConvert('0x')).to.equal('0');
  //     expect(await anchor.testConvert('0x0000000000000000000000000000000000000000000000000000000000000000')).to.equal('0');
  //     expect(await anchor.testConvert('0x0000000000000000000000000000000000000000000000000000000000000001')).to.equal('1');
  //   });
  // });

  describe("Rollup", function () {
    it("Should not forward from random submitter", async function () {
      const { target, owner } = await loadFixture(deployFixture);
      await expect(
        target.connect(owner).rollupU256CondEq(
          // cond
          [], [],
          // updates
          [], [],
          // actions
          ['0x00DEADBEEF'],
        )
      ).to.be.revertedWith('bad submitter');
    });

    it("Should not allow invalid input arrays", async function () {
      const { target, submitter } = await loadFixture(deployFixture);

      await expect(
        target.connect(submitter).rollupU256CondEq(
          // cond
          ['0x01'], [],
          // updates
          [], [],
          // actions
          ['0x00DEADBEEF'],
        )
      ).to.be.revertedWith('bad cond len');

      await expect(
        target.connect(submitter).rollupU256CondEq(
          // cond
          [], [],
          // updates
          ['0x'], [],
          // actions
          ['0x00DEADBEEF'],
        )
      ).to.be.revertedWith('bad update len');
    });

    it("Should forward actions", async function () {
      const { target, submitter } = await loadFixture(deployFixture);

      await expect(
        target.connect(submitter).rollupU256CondEq(
          // cond
          ['0x01'],
          [encodeUint32(0)],
          // updates
          ['0x01'],
          [encodeUint32(1)],
          // actions (0x01 - callback; 0xdeadbeef - data)
          ['0x00DEADBEEF'],
        )
      ).not.to.be.reverted;

      expect(await target.getRecvLength()).to.be.equals('1');
      expect(await target.getRecv(0)).to.be.eql('0xdeadbeef');
      expect(await target.getStorage('0x01')).to.be.equals(encodeUint32(1));
    });
  });

  describe("OptimisticLock", function () {
    it("Should reject conflicting transaction", async function () {
      const { target, submitter } = await loadFixture(deployFixture);
      // Rollup from v0 to v1
      await expect(
        target.connect(submitter).rollupU256CondEq(
          // cond
          ['0x01'],
          [encodeUint32(0)],
          // updates
          ['0x01'],
          [encodeUint32(1)],
          // actions
          ['0x00DEADBEEF'],
        )
      ).not.to.be.reverted;
      expect(await target.getStorage('0x01')).to.be.equals(encodeUint32(1));
      // Rollup to v1 again
      await expect(
        target.connect(submitter).rollupU256CondEq(
          // cond
          ['0x01'],
          [encodeUint32(0)],
          // updates
          ['0x01'],
          [encodeUint32(1)],
          // actions
          ['0x00DEADBEEF'],
        )
      ).to.be.revertedWith('cond not met');
    });
  });


  describe("Rollup", function () {
    it("Can process requests", async function () {
        const { target, owner, submitter } = await loadFixture(deployFixture);
        const pushTx = await target.connect(owner).pushMessage('0xdecaffee');
        await expect(pushTx).not.to.be.reverted;
        await expect(pushTx).to
            .emit(target, 'MessageQueued')
            .withArgs(0, '0xdecaffee');
        // Simulate a rollup
        const rollupTx = await target.connect(submitter).rollupU256CondEq(
                // cond (global=1)
                ['0x00'],
                [encodeUint32(0)],
                // updates (global=2)
                ['0x00'],
                [encodeUint32(1)],
                // actions 
                [
                    // Callback: req 00 responded with 0xDEADBEEF
                    ethers.utils.hexConcat(['0x00', encodeUint32(0), '0xDEADBEEF']),
                    // Custom: queue processed to 1
                    ethers.utils.hexConcat(['0x01', encodeUint32(1)]),
                ],
            )
        await expect(rollupTx).not.to.be.reverted;
        await expect(rollupTx).to
            .emit(target, 'MessageProcessedTo')
            .withArgs(1);

        // Check queue processed
        expect(await target.getRecvLength()).to.be.equals('1');
        expect(await target.getRecv(0)).to.be.eql('0x0000000000000000000000000000000000000000000000000000000000000000deadbeef');
        // end
        expect(await target.queueGetUint(hex('_tail'))).to.be.equals(1);
        // start
        expect(await target.queueGetUint(hex('_head'))).to.be.equals(1);
    })
  });

  describe("Meta Transaction", function () {
    it("Can process requests", async function () {
        const { target, owner, submitter, submitter2 } = await loadFixture(deployFixture);
        // Add submitter 2
        const submitterRole = await target.SUBMITTER_ROLE();
        const grantTx = await target
          .connect(owner)
          .grantRole(submitterRole, submitter2.address);
        await expect(grantTx).not.to.be.reverted;
        await expect(grantTx).to
            .emit(target, 'RoleGranted')
            .withArgs(submitterRole, submitter2.address, owner.address);

        // Push a message
        const pushTx = await target.connect(owner).pushMessage('0xdecaffee');
        await expect(pushTx).not.to.be.reverted;
        await expect(pushTx).to
            .emit(target, 'MessageQueued')
            .withArgs(0, '0xdecaffee');

        // Rollup with meta-tx
        const rollupParams = ethers.utils.defaultAbiCoder.encode(
          ['bytes[]', 'bytes[]', 'bytes[]', 'bytes[]', 'bytes[]'],
          [
            ['0x00'],
            [encodeUint32(0)],
            ['0x00'],
            [encodeUint32(1)],
            [
                // Callback: req 00 responded with 0xDEADBEEF
                ethers.utils.hexConcat(['0x00', encodeUint32(0), '0xDEADBEEF']),
                // Custom: queue processed to 1
                ethers.utils.hexConcat(['0x01', encodeUint32(1)]),
            ],
          ]
        );
        const metaTxData = {
          from: submitter2.address,
          nonce: 0,
          data: rollupParams,
        };
        const metaTxSig = await signMetaTx(submitter2, target.address, metaTxData);
        const rollupTx = await target.connect(submitter).metaTxRollupU256CondEq(metaTxData, metaTxSig);
        await expect(rollupTx).not.to.be.reverted;
        await expect(rollupTx).to
            .emit(target, 'MessageProcessedTo')
            .withArgs(1);

        // Check queue processed
        expect(await target.getRecvLength()).to.be.equals('1');
        expect(await target.getRecv(0)).to.be.eql('0x0000000000000000000000000000000000000000000000000000000000000000deadbeef');
        // end
        expect(await target.queueGetUint(hex('_tail'))).to.be.equals(1);
        // start
        expect(await target.queueGetUint(hex('_head'))).to.be.equals(1);
    })
  });

  it.skip("can control submitter via meta tx",  async function () {
    // TODO
  });
});


function abiEncode(type: string, value: any) {
  return ethers.utils.defaultAbiCoder.encode([type], [value]);
}
function encodeUint32(v: number) {
  return abiEncode('uint32', v);
}
function hex(str: string): string {
  return ethers.utils.hexlify(ethers.utils.toUtf8Bytes(str));
}
async function signMetaTx(signer: SignerWithAddress, contractAddress: string, value: { from: string, nonce: number, data: string }) {
  // All properties on a domain are optional
  const domain = {
    name: 'PhatRollupMetaTxReceiver',
    version: '0.0.1',
    chainId: 31337,  // hardhat chain id
    verifyingContract: contractAddress
  };
  const types = {
    ForwardRequest: [
        { name: 'from', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'data', type: 'bytes' }
    ]
  };
  return await signer._signTypedData(domain, types, value);
}
