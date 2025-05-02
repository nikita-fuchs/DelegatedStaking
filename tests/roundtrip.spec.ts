import { describe } from "mocha";
import * as chai from 'chai'    
import { expect } from 'chai'    
import chaiAsPromised from 'chai-as-promised'
import * as dotenv from 'dotenv';
chai.use(chaiAsPromised)
import pkg from 'lodash';
import { Viva } from "../src";
import typia from "typia";
import { getOAuthTokenResponse } from "../src/types";


const { isEqual } = pkg;


dotenv.config();

const viva = new Viva('demo');
let stopAfterTest = false;

describe('Simple roundtrip:', function () {
  this.timeout(80000);
  beforeEach(async function () {

    if (stopAfterTest) {
      this.skip(); // Skip remaining tests
    }
   
  });

  it('should log in ti Viva and get an OAuth token', async function () {
    console.log('Logging into viva..');
    let response = await viva.getOAuthToken();
    if ('data' in response) {
      let valid = typia.assert<getOAuthTokenResponse>(response.data);
      chai.expect(valid).to.be.true;
    } else {
      throw new Error('Failed to get OAuth token: ' + response.message);
    }
  });

});
