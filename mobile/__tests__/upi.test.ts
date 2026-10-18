import {parseUpiQr, upiPayUrl} from '../src/payments/upi';

describe('UPI links', () => {
  it('fills the payee and leaves the amount to the payer by default', () => {
    const url = upiPayUrl('tez://upi/pay', {upiId: 'asha@okhdfc', name: 'Asha Rao', note: 'SplitMate Goa'});
    expect(url).toBe('tez://upi/pay?pa=asha%40okhdfc&pn=Asha%20Rao&cu=INR&tn=SplitMate%20Goa');
    expect(url).not.toContain('am=');
  });

  it('adds the amount only when asked', () => {
    expect(upiPayUrl('upi://pay', {upiId: 'a@ybl', name: 'A', amount: '100.00'})).toContain('&am=100.00');
  });

  it('reads the payee from a UPI QR', () => {
    expect(parseUpiQr('upi://pay?pa=ravi.k@okicici&pn=Ravi%20K&mc=0000&tr=x')).toEqual({upiId: 'ravi.k@okicici', name: 'Ravi K'});
    expect(parseUpiQr('UPI://pay?pn=Shop+Name&pa=shop@paytm')).toEqual({upiId: 'shop@paytm', name: 'Shop Name'});
  });

  it('rejects anything that is not a UPI QR', () => {
    expect(parseUpiQr('https://example.com')).toBeNull();
    expect(parseUpiQr('upi://pay?pn=NoId')).toBeNull();
    expect(parseUpiQr('upi://pay?pa=not-an-id')).toBeNull();
    expect(parseUpiQr('upi://pay?pa=%E0%A4%A')).toBeNull();
  });
});
