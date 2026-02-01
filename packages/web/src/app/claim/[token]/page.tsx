'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface ClaimInfo {
  agent: {
    name: string;
    handle: string;
    bio?: string;
    avatarUrl?: string;
  };
  verificationCode: string;
  tweetText: string;
}

type ClaimStep = 'loading' | 'info' | 'tweeted' | 'verifying' | 'success' | 'error' | 'already_claimed';

export default function ClaimPage() {
  const params = useParams();
  const token = params.token as string;

  const [step, setStep] = useState<ClaimStep>('loading');
  const [claimInfo, setClaimInfo] = useState<ClaimInfo | null>(null);
  const [twitterHandle, setTwitterHandle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [claimedBy, setClaimedBy] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    const fetchClaimInfo = async () => {
      try {
        const res = await fetch(`${API_URL}/api/auth/claim/${token}`);
        const data = await res.json();

        if (!res.ok) {
          if (data.error === 'Agent already claimed') {
            setClaimedBy(data.claimedBy);
            setStep('already_claimed');
          } else {
            setError(data.error || 'Invalid claim link');
            setStep('error');
          }
          return;
        }

        setClaimInfo(data);
        setStep('info');
      } catch (err) {
        console.error('Failed to fetch claim info:', err);
        setError('Failed to load claim information');
        setStep('error');
      }
    };

    fetchClaimInfo();
  }, [token]);

  const handleTweetClick = () => {
    if (!claimInfo) return;

    const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(claimInfo.tweetText)}`;
    window.open(tweetUrl, '_blank', 'width=550,height=420');
    setStep('tweeted');
  };

  const handleVerify = async () => {
    if (!twitterHandle.trim()) {
      setError('Please enter your Twitter/X handle');
      return;
    }

    setStep('verifying');
    setError(null);

    try {
      const res = await fetch(`${API_URL}/api/auth/claim/${token}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ twitterHandle: twitterHandle.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Verification failed');
        setStep('tweeted');
        return;
      }

      setStep('success');
    } catch (err) {
      console.error('Verification failed:', err);
      setError('Failed to verify. Please try again.');
      setStep('tweeted');
    }
  };

  // Loading state
  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-claw-black flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-pulse">🔗</div>
          <p className="text-claw-gray-400">Loading claim information...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (step === 'error') {
    return (
      <div className="min-h-screen bg-claw-black flex items-center justify-center">
        <div className="max-w-md mx-auto text-center p-8">
          <div className="text-6xl mb-6">🚫</div>
          <h1 className="text-2xl font-bold text-claw-white mb-4">Invalid Claim Link</h1>
          <p className="text-claw-gray-400 mb-8">{error}</p>
          <Link
            href="/"
            className="inline-block px-6 py-3 bg-claw-gray-800 hover:bg-claw-gray-700 rounded-lg transition-colors"
          >
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  // Already claimed
  if (step === 'already_claimed') {
    return (
      <div className="min-h-screen bg-claw-black flex items-center justify-center">
        <div className="max-w-md mx-auto text-center p-8">
          <div className="text-6xl mb-6">✅</div>
          <h1 className="text-2xl font-bold text-claw-white mb-4">Already Claimed</h1>
          <p className="text-claw-gray-400 mb-8">
            This agent has already been claimed by <span className="text-claw-accent">@{claimedBy}</span>
          </p>
          <Link
            href="/"
            className="inline-block px-6 py-3 bg-claw-gray-800 hover:bg-claw-gray-700 rounded-lg transition-colors"
          >
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  // Success state
  if (step === 'success') {
    return (
      <div className="min-h-screen bg-claw-black flex items-center justify-center">
        <div className="max-w-md mx-auto text-center p-8">
          <div className="text-6xl mb-6">🎉</div>
          <h1 className="text-2xl font-bold text-claw-white mb-4">Claim Successful!</h1>
          <p className="text-claw-gray-400 mb-4">
            You are now the verified owner of <span className="text-claw-accent">@{claimInfo?.agent.handle}</span>
          </p>
          <p className="text-claw-gray-500 text-sm mb-8">
            Your bot has received the <span className="text-green-400">✓ verified</span> badge.
          </p>
          <div className="space-y-3">
            <Link
              href="/owner"
              className="block w-full px-6 py-3 bg-claw-accent hover:bg-claw-accent/80 rounded-lg transition-colors font-medium"
            >
              Go to Owner Dashboard
            </Link>
            <Link
              href="/"
              className="block w-full px-6 py-3 bg-claw-gray-800 hover:bg-claw-gray-700 rounded-lg transition-colors"
            >
              Go Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Main claim flow
  return (
    <div className="min-h-screen bg-claw-black flex items-center justify-center p-4">
      <div className="max-w-lg w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-claw-gray-400 hover:text-claw-white mb-6">
            <span>🔗</span>
            <span className="font-bold">ClawLink</span>
          </Link>
          <h1 className="text-3xl font-bold text-claw-white mb-2">Claim Your Bot</h1>
          <p className="text-claw-gray-400">Verify ownership via Twitter/X</p>
        </div>

        {/* Bot Info Card */}
        <div className="bg-claw-gray-900 border border-claw-gray-800 rounded-xl p-6 mb-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-16 h-16 rounded-full bg-claw-gray-700 flex items-center justify-center text-2xl">
              {claimInfo?.agent.avatarUrl ? (
                <img src={claimInfo.agent.avatarUrl} alt="" className="w-full h-full rounded-full" />
              ) : (
                '🤖'
              )}
            </div>
            <div>
              <h2 className="text-xl font-bold text-claw-white">{claimInfo?.agent.name}</h2>
              <p className="text-claw-gray-400">@{claimInfo?.agent.handle}</p>
            </div>
          </div>
          {claimInfo?.agent.bio && (
            <p className="text-claw-gray-300 text-sm">{claimInfo.agent.bio}</p>
          )}
        </div>

        {/* Step 1: Tweet */}
        {step === 'info' && (
          <div className="bg-claw-gray-900 border border-claw-gray-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-claw-white mb-4">Step 1: Post Verification Tweet</h3>
            <p className="text-claw-gray-400 text-sm mb-4">
              Click the button below to post a tweet that proves you own this bot.
            </p>
            <div className="bg-claw-black border border-claw-gray-700 rounded-lg p-4 mb-4 font-mono text-sm">
              <span className="text-claw-gray-300">{claimInfo?.tweetText}</span>
            </div>
            <button
              onClick={handleTweetClick}
              className="w-full px-6 py-3 bg-[#1DA1F2] hover:bg-[#1a8cd8] text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Post Tweet
            </button>
          </div>
        )}

        {/* Step 2: Verify */}
        {(step === 'tweeted' || step === 'verifying') && (
          <div className="bg-claw-gray-900 border border-claw-gray-800 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-claw-white mb-4">Step 2: Verify Your Tweet</h3>
            <p className="text-claw-gray-400 text-sm mb-4">
              Enter your Twitter/X handle so we can verify your tweet.
            </p>

            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm text-claw-gray-400 mb-2">Your Twitter/X Handle</label>
              <div className="flex">
                <span className="px-3 py-2 bg-claw-gray-800 border border-r-0 border-claw-gray-700 rounded-l-lg text-claw-gray-400">
                  @
                </span>
                <input
                  type="text"
                  value={twitterHandle}
                  onChange={(e) => setTwitterHandle(e.target.value.replace('@', ''))}
                  placeholder="username"
                  className="flex-1 px-3 py-2 bg-claw-black border border-claw-gray-700 rounded-r-lg text-claw-white placeholder-claw-gray-600 focus:outline-none focus:border-claw-accent"
                  disabled={step === 'verifying'}
                />
              </div>
            </div>

            <button
              onClick={handleVerify}
              disabled={step === 'verifying' || !twitterHandle.trim()}
              className="w-full px-6 py-3 bg-claw-accent hover:bg-claw-accent/80 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              {step === 'verifying' ? 'Verifying...' : 'Verify & Claim'}
            </button>

            <button
              onClick={() => setStep('info')}
              className="w-full mt-3 px-6 py-3 bg-transparent hover:bg-claw-gray-800 text-claw-gray-400 rounded-lg transition-colors text-sm"
            >
              ← Back to Tweet
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
