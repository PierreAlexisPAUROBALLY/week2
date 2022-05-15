pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/switcher.circom";




template CheckRoot(n) { // compute the root of a MerkleTree of n Levels 
    //assert (n>0);
    signal input leaves[2**n];
    signal output root;

    // using the logic found here : https://github.com/appliedzkp/incrementalquintree/blob/master/circom/checkRoot.circom
    // 1st we need to know hwo many intermediate leafs we have; 2**(n-1) + 2**(n-2) ... until n =0
    var numHashers =0;
    for (var i =0; i<n;i++){
        numHashers += 2**i;
    }


    component hashers[numHashers]; // we initiate the hasers component (in our case, will be Poseidon(2))
    for (var i=0;i<numHashers;i++){// initialise our hashers
        hashers[i]=Poseidon(2);
    }

    //init loop: the first hashers that depend on the input leaves.
    for (var i = 0; i< 2**(n-1);i++){
        for (var j =0 ; j<2 ; j++){
            hashers[i].inputs[j] <==leaves[i*2 +j];
        }
    }

    // now need to iter over all depth and compute the hashes from layer n-1 to output
    var k=0;
    for (var i= 2**(n-1);i<numHashers;i++){// interate on hashers from the 1st that isnt a leaf inputed.
        for(var j =0 ; j<2 ;j++){ // wire output of layer k to layer k+1
            hashers[i].inputs[j] <== hashers[k *2 +j].out;
        }

        k++;
    }

root <== hashers[numHashers-1].out;

}



template MerkleTreeInclusionProof(n) {
    signal input leaf;
    signal input path_elements[n];
    signal input path_index[n]; // path index are 0's and 1's indicating whether the current element is on the left or right

    signal output root; // note that this is an OUTPUT signal

    // we will need n hashers
    component hashers[n];
    component switcher[n];// if needs inversion or not

    for (var i=0;i<n;i++){// initialise our hashers
        hashers[i]=Poseidon(2);
        switcher[i]=Switcher();
    }



    switcher[0].sel <== path_index[0];
    switcher[0].L <== leaf;
    switcher[0].R <== path_elements[0];

    hashers[0].inputs[0] <== switcher[0].outL;
    hashers[0].inputs[1] <== switcher[0].outR;

    for (var i=1 ;i<n;i++){
        switcher[i].sel <== path_index[i];
        switcher[i].L <== hashers[i-1].out;
        switcher[i].R <== path_elements[i];

        hashers[i].inputs[0] <== switcher[i].outL;
        hashers[i].inputs[1] <== switcher[i].outR;

    }
    root <== hashers[n-1].out;










    // initialize the 1st hashers taking the leaf as input
    /*
    hashers[0].inputs[path_index[0]] <== leaf;
    hashers[0].inputs[path_nonindex[0]] <== path_elements[0];


    for (var i=1; i<n; i++){
        hashers[i].inputs[path_index[i]] <== hashers[i-1].out;
        hashers[i].inputs[path_nonindex[i]] <== path_elements[i];
    } */
     //root <== hashers[n-1].out;
    // this part doesnt work because non quadratic constraint, need to use some kind of if else (multiplexer?)





   


}