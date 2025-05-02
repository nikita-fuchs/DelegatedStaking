export type vivaSetupConfig = {
    VIVA_SMART_CHECKOUT_ID: string;
    VIVA_SMART_CHECKOUT_PW: string;
    VIVA_API_URL: string;
}


export const getVivaDemoConfig = (): vivaSetupConfig => {
    return {
        VIVA_SMART_CHECKOUT_ID: process.env.VIVA_SMART_CHECKOUT_ID || 'cci01v6xmgzbqf8b2hv51zcwc0pl50j98g08hf1g6zb40',
        VIVA_SMART_CHECKOUT_PW: process.env.VIVA_SMART_CHECKOUT_PW || 'te7j3Ms953683QC282vq51jtZA4asK',
        VIVA_API_URL: process.env.VIVA_API_URL || 'https://demo-accounts.vivapayments.com',
    }
}