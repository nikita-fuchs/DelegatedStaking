import { describe } from "mocha";
import * as chai from 'chai'    
import { expect } from 'chai'    
import chaiAsPromised from 'chai-as-promised'
import * as dotenv from 'dotenv';
chai.use(chaiAsPromised)
import pkg from 'lodash';
import { Viva } from "../src/index.js";
import typia from "typia";
import { getOAuthTokenResponse } from "../src/types.js";


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

  it('should log in to Viva and get an OAuth token', async function () {
    console.log('Logging into viva..');
    let response = await viva.getOAuthToken();
    //@ts-ignore
    if ('data' in response) {
      //console.log('Response:', response.data);
      try {
        let check = typia.is<getOAuthTokenResponse>(response.data);
        // If we get here, the validation passed
        expect(check).to.be.true;
      } catch (error) {
        console.error("Validation error:", error);
        expect.fail("Response data did not match expected type");
      }
    } else {
      throw new Error('Failed to get OAuth token: ' + response.message);
    }
  });

});
