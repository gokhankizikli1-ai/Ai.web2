import { Link } from 'react-router';
import { ArrowLeft, Check, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Navbar from '@/sections/Navbar';
import Footer from '@/sections/Footer';

const plans = [
  {
    name: 'Free',
    price: '$0',
    period: '/month',
    description: 'Perfect for getting started and casual use.',
    features: [
      '100 messages per day',
      'Standard response speed',
      'Web access',
      'Basic code assistance',
      'Community support',
    ],
    cta: 'Get Started',
    popular: false,
  },
  {
    name: 'Pro',
    price: '$20',
    period: '/month',
    description: 'For professionals who need more power and speed.',
    features: [
      'Unlimited messages',
      '2x faster responses',
      'Priority access',
      'Advanced code features',
      'File uploads & analysis',
      'Custom instructions',
      'Email support',
    ],
    cta: 'Start Pro Trial',
    popular: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'For teams that need security and control.',
    features: [
      'Everything in Pro',
      'SSO & SAML',
      'Audit logs',
      'Dedicated support',
      'Custom integrations',
      'On-premise option',
      'SLA guarantees',
    ],
    cta: 'Contact Sales',
    popular: false,
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-foreground">
      <Navbar />
      <main className="pt-28 pb-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          {/* Breadcrumb */}
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-8"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </Link>

          <div className="text-center mb-16">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-4">
              Simple, Transparent Pricing
            </h1>
            <p className="text-slate-400 max-w-xl mx-auto text-base sm:text-lg">
              Choose the plan that fits your workflow. Upgrade or downgrade anytime.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl border p-8 flex flex-col ${
                  plan.popular
                    ? 'border-cyan-500/30 bg-gradient-to-b from-cyan-500/10 to-transparent'
                    : 'border-white/10 bg-white/[0.02]'
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <div className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 px-3 py-1 text-xs font-semibold text-white">
                      <Sparkles className="h-3 w-3" />
                      Most Popular
                    </div>
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-lg font-semibold text-white mb-2">{plan.name}</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-white">{plan.price}</span>
                    <span className="text-slate-500">{plan.period}</span>
                  </div>
                  <p className="text-sm text-slate-400 mt-2">{plan.description}</p>
                </div>

                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-sm text-slate-300">
                      <Check className={`h-4 w-4 shrink-0 mt-0.5 ${plan.popular ? 'text-cyan-400' : 'text-slate-500'}`} />
                      {feature}
                    </li>
                  ))}
                </ul>

                <Button
                  className={`w-full h-11 font-semibold ${
                    plan.popular
                      ? 'bg-white text-slate-900 hover:bg-slate-200'
                      : 'bg-white/5 text-white hover:bg-white/10 border border-white/10'
                  }`}
                >
                  {plan.cta}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
