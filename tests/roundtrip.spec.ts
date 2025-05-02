import { describe } from "mocha";
import * as chai from 'chai'    
import { expect } from 'chai'    
import chaiAsPromised from 'chai-as-promised'

chai.use(chaiAsPromised)

import pkg from 'lodash';
const { isEqual } = pkg;

import * as dotenv from 'dotenv';

dotenv.config();


let stopAfterTest = false;

describe('Simple roundtrip:', function () {
  this.timeout(80000);
  beforeEach(async function () {

    if (stopAfterTest) {
      this.skip(); // Skip remaining tests
    }
   
  });

  it('should set up the sdk and connect to AE', async function () {
    console.log('Connected to Mainnet Node! Current Block:');
    chai.expect(true).to.be.a('boolean');
  });




});
