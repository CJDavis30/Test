import { describe, it, expect } from 'vitest';
import { analyzeHeaders } from '../shared/forensics/headers';

const SAMPLE = `Received: from mail-wr1-f41.google.com (mail-wr1-f41.google.com [209.85.221.41])
	by mx.example.org (Postfix) with ESMTPS id ABC123
	for <victim@example.org>; Tue, 05 Mar 2024 15:02:41 +0000 (UTC)
Received: from [192.168.1.20] (203.0.113.77) by mail-wr1-f41.google.com with HTTP;
	Tue, 5 Mar 2024 09:02:30 -0600
Authentication-Results: mx.example.org; spf=pass smtp.mailfrom=gmail.com; dkim=pass header.d=gmail.com; dmarc=fail header.from=bank-secure.example
From: "Support" <support@bank-secure.example>
Reply-To: <collect@elsewhere.example>
Return-Path: <bounce@gmail.com>
To: victim@example.org
Subject: Please verify
Date: Tue, 5 Mar 2024 09:02:28 -0600
Message-ID: <abc@mail.gmail.com>
X-Mailer: Mutt

body here`;

describe('email header forensics', () => {
  const r = analyzeHeaders(SAMPLE)!;
  it('reads the route in the order the message travelled', () => {
    expect(r.hops.length).toBe(2);
    expect(r.hops[0].by).toBe('mail-wr1-f41.google.com');          // first hop is the LAST Received line
    expect(r.hops[0].ip).toBe('203.0.113.77');                       // the sender's own connection, not the private address
    expect(r.hops[1].delaySec).toBe(Math.round((Date.parse('2024-03-05T15:02:41Z') - Date.parse('2024-03-05T15:02:30Z')) / 1000));
    expect(r.originIp).toBe('203.0.113.77');
  });
  it("reads the sender's timezone from the Date line", () => {
    expect(r.sent!.tz).toBe('UTC−06:00'); expect(r.sent!.offsetMin).toBe(-360);
    expect(r.findings.some((f) => /UTC−06:00/.test(f.text))).toBe(true);
  });
  it('flags authentication failures and impersonation patterns', () => {
    expect(r.auth).toMatchObject({ spf: 'pass', dkim: 'pass', dmarc: 'fail' });
    expect(r.findings.some((f) => /DMARC/.test(f.text))).toBe(true);
    expect(r.findings.some((f) => /different domain/.test(f.text))).toBe(true);
  });
  it('notices a forged-looking timeline', () => {
    const forged = SAMPLE.replace('Tue, 5 Mar 2024 09:02:30 -0600', 'Tue, 5 Mar 2024 11:59:59 -0600');
    expect(analyzeHeaders(forged)!.findings.some((f) => f.level === 'bad')).toBe(true);
  });
  it('returns nothing for text that is not a header, and survives junk', () => {
    expect(analyzeHeaders('hello world')).toBeNull();
    expect(() => analyzeHeaders('Received: ' + 'x'.repeat(300_000))).not.toThrow();
    expect(analyzeHeaders('From: a@b.example\nDate: not a date')!.sent).toBeUndefined();
  });
});
