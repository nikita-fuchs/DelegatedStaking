// APIS: Everything from https://developer.viva.com/apis-for-payments/payment-api/#tag/Marketplace-Sellers
// and authentication

const axios = require('axios');
const qs = require('qs');
import * as dotenv from 'dotenv';
import { getVivaDemoConfig, vivaSetupConfig } from '../config/demo';
import { getVivaProductionConfig } from '../config/prod';
import { AxiosError, AxiosResponse } from 'axios';
import { getOAuthTokenResponse } from './types';
dotenv.config();


export class Viva {
    public readonly config: vivaSetupConfig;

    constructor(environment: 'demo' | 'production') {
        this.config = environment == 'demo' ? getVivaDemoConfig() : getVivaProductionConfig();
    }


/* Authentication
* To submit payments with Viva, you will be making API requests that are authenticated using your account credentials.
*
* If you don't include them when making an API request, or use incorrect credentials, you will get an error. 
*/
public getOAuthToken = async () : Promise<AxiosResponse<getOAuthTokenResponse> | AxiosError<unknown>> => {
    // Your credentials
    const username = this.config.VIVA_SMART_CHECKOUT_ID;
    const password = this.config.VIVA_SMART_CHECKOUT_PW;
    
    // Create the Basic Auth string by encoding username:password in Base64
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    
    let data = qs.stringify({
      'grant_type': 'client_credentials' 
    });
    
    let config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: `${this.config.VIVA_API_URL}/connect/token`,
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded', 
        'Authorization': `Basic ${auth}`
      },
      data: data
    };
    
    try {
      const response = await axios.request(config);
    //   console.log(JSON.stringify(response.data));
      return response;
    } catch (error) {
      console.log(error);
      return error as AxiosError;
    }
}

public createConnectedAccount = async () => {
    
}

}