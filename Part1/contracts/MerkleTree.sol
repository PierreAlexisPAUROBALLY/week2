//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import {PoseidonT3} from "./Poseidon.sol"; //an existing library to perform Poseidon hash on solidity
import "./verifier.sol"; //inherits with the MerkleTreeInclusionProof verifier contract
import "hardhat/console.sol";
contract MerkleTree is Verifier {
    uint256[] public hashes; // the Merkle tree in flattened array form
    uint256 public index = 0; // the current index of the first unfilled leaf
    uint256 public root; // the current Merkle root

    constructor() {
        // [assignment] initialize a Merkle tree of 8 with blank leaves
        // we could also precompute the hashes and set them manually since they are always going to be the same.
        hashes = [0, 0, 0, 0, 0, 0, 0, 0];

        for (uint256 i = 0; i < 7; i++) {
            uint256 interm_hash = PoseidonT3.poseidon(
                [hashes[2 * i], hashes[2 * i + 1]]
            );
            hashes.push(interm_hash);
        }
        root = hashes[14];
    }
/*
    function _insertLeaf(uint256 hashedLeaf) public returns (uint256) {
        // [assignment] insert a hashed leaf into the Merkle tree

        //completely unoptimised since we relcaculate the wole tree each time. 
        // [todo] rewrite

        hashes[index] = hashedLeaf;
        uint256 hix = 8;

        for (uint256 i = 0; i < 7; i++) {
            uint256 interm_hash = PoseidonT3.poseidon(
                [hashes[2 * i], hashes[2 * i + 1]]
            );
            hashes[hix] = interm_hash;
            hix++;
        }

        index++;
        root = hashes[14];
        return root;
    }
*/
    function insertLeaf(uint256 hashedLeaf) public returns (uint256) {

        uint depth=3;//hardset here, can easily be modified for another depth
        uint Lix=0;//ix of 1st leaf at current depth
        uint nodeToModifIncrement=index;// ix of leaf to modify at current depth minus Lix
        uint Mix = index; // last modified leaf (NTM from round -1)
        uint leafsAtDepth=0;
        uint NTM=index;// node to modify index

        

        for (uint i = depth ; i!=0 ; i--){///iter from leafs to root
            //console.log(i);
            leafsAtDepth = 2**i;

            if (i == depth){//init loop
                hashes[index]= hashedLeaf;
            }
            else{
            NTM= Lix + nodeToModifIncrement;// node to modify
            //console.log('NTM',NTM);
            //console.log('LIX',Lix);

            if(Mix%2==0){// if the node to modify (Mix) is %2 then we take the Mix+1 else Mix-1; also need to hash in order 
                hashes[NTM]=PoseidonT3.poseidon([hashes[Mix], hashes[Mix+1]]);
            }
            else{
                hashes[NTM]=PoseidonT3.poseidon([hashes[Mix-1], hashes[Mix]]);
            }
            Mix=NTM;// for next round, Modified Index is current node to modify
            }

            
            nodeToModifIncrement= nodeToModifIncrement/2;// the increment of nodetomodify per depth (ex: 1 0 0 [ 1 , 8+0,12+0] ; 3 1 0 ; 7 3 1 [7, 8+3 , 12+1])
            Lix=Lix + leafsAtDepth;// Last Index (first element in Hasharray for next round)
            
        }

        root=hashes[14];// last element Lix
        return root;
    }



    


    function verify(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[1] memory input
    ) public view returns (bool) {
        // [assignment] verify an inclusion proof and check that the proof root matches current root
        return (Verifier.verifyProof(a, b, c, input));
    }
}
