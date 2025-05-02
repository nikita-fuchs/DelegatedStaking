import { vivaSetupConfig } from "./demo"

export const getVivaProductionConfig = (): vivaSetupConfig => {
    return {
        VIVA_SMART_CHECKOUT_ID: process.env.VIVA_SMART_CHECKOUT_ID || '',
        VIVA_SMART_CHECKOUT_PW: process.env.VIVA_SMART_CHECKOUT_PW || '',
        VIVA_API_URL: process.env.VIVA_API_URL || 'https://accounts.vivapayments.com',
    }
}