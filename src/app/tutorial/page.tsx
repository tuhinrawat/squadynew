'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ArrowRight, ArrowLeft, BookOpen, Play, Users, Settings, Globe, Zap, ChevronRight } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

type TutorialStep = {
  id: string
  title: string
  description: string
  icon: JSX.Element
  content: JSX.Element
}

const tutorialSteps: TutorialStep[] = [
  {
    id: 'create',
    title: 'Create Your Auction',
    description: 'Set up a new auction with basic details',
    icon: <Play className="h-8 w-8 text-blue-600" />,
    content: (
      <div className="space-y-6">
        <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-lg border-2 border-blue-200 dark:border-blue-800">
          <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-4">📝 Auction Information</h3>
          <ul className="space-y-3 text-gray-700 dark:text-gray-300">
            <li className="flex items-start">
              <ChevronRight className="h-5 w-5 text-blue-600 dark:text-blue-400 mr-2 mt-0.5 flex-shrink-0" />
              <span><strong>Auction Name:</strong> Choose a descriptive name (e.g., "IPL 2024 Player Auction")</span>
            </li>
            <li className="flex items-start">
              <ChevronRight className="h-5 w-5 text-blue-600 dark:text-blue-400 mr-2 mt-0.5 flex-shrink-0" />
              <span><strong>Description:</strong> Add details about the auction event</span>
            </li>
            <li className="flex items-start">
              <ChevronRight className="h-5 w-5 text-blue-600 dark:text-blue-400 mr-2 mt-0.5 flex-shrink-0" />
              <span><strong>Status:</strong> Starts as "DRAFT" - you can edit until published</span>
            </li>
          </ul>
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 p-4 rounded">
          💡 <strong>Tip:</strong> Navigate to Dashboard → "Create New Auction" button to get started
        </div>
      </div>
    )
  },
  {
    id: 'rules',
    title: 'Configure Auction Rules',
    description: 'Set bid increment, countdown timer, and team constraints',
    icon: <Settings className="h-8 w-8 text-purple-600" />,
    content: (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-purple-200 dark:border-purple-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">💰 Bid Increment</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-purple-600">₹1,000</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Minimum amount between bids</p>
            </CardContent>
          </Card>
          <Card className="border-blue-200 dark:border-blue-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">⏱️ Countdown Timer</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-blue-600">15 seconds</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Time to place bids</p>
            </CardContent>
          </Card>
        </div>
        
        <div className="bg-purple-50 dark:bg-purple-900/20 p-6 rounded-lg border-2 border-purple-200 dark:border-purple-800">
          <h3 className="text-lg font-semibold text-purple-900 dark:text-purple-100 mb-4">⚙️ Advanced Settings</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="font-semibold text-sm mb-2">Icon Players</p>
              <p className="text-gray-600 dark:text-gray-400">10 max</p>
            </div>
            <div>
              <p className="font-semibold text-sm mb-2">Mandatory Team Size</p>
              <p className="text-gray-600 dark:text-gray-400">12 players</p>
            </div>
            <div>
              <p className="font-semibold text-sm mb-2">Max Bidders</p>
              <p className="text-gray-600 dark:text-gray-400">10 teams</p>
            </div>
            <div>
              <p className="font-semibold text-sm mb-2">Purse Enforcement</p>
              <p className="text-gray-600 dark:text-gray-400">Enabled</p>
            </div>
          </div>
        </div>
      </div>
    )
  },
  {
    id: 'players',
    title: 'Manage Players',
    description: 'Upload and organize player data',
    icon: <Users className="h-8 w-8 text-green-600" />,
    content: (
      <div className="space-y-6">
        <div className="bg-green-50 dark:bg-green-900/20 p-6 rounded-lg border-2 border-green-200 dark:border-green-800">
          <h3 className="text-lg font-semibold text-green-900 dark:text-green-100 mb-4">📤 Upload Methods</h3>
          <div className="space-y-4">
            <div className="flex items-start">
              <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold mr-3 mt-0.5">1</div>
              <div>
                <p className="font-semibold">Excel/CSV Upload</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">Upload player data in CSV format with any columns (Name, Age, Role, etc.)</p>
              </div>
            </div>
            <div className="flex items-start">
              <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold mr-3 mt-0.5">2</div>
              <div>
                <p className="font-semibold">Manual Entry</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">Add players individually with custom fields</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-green-200 dark:border-green-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Status Tracking</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Badge className="bg-blue-500">AVAILABLE</Badge>
                <Badge className="bg-green-500">SOLD</Badge>
                <Badge className="bg-yellow-500">UNSOLD</Badge>
              </div>
            </CardContent>
          </Card>
          <Card className="border-green-200 dark:border-green-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Icon Players</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-green-600">⭐ Mark as Icon</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Prioritize key players</p>
            </CardContent>
          </Card>
          <Card className="border-green-200 dark:border-green-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Custom Fields</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600 dark:text-gray-400">Support any data structure - stats, images, bio</p>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  },
  {
    id: 'bidders',
    title: 'Manage Bidders',
    description: 'Add teams and set up bidding accounts',
    icon: <Users className="h-8 w-8 text-orange-600" />,
    content: (
      <div className="space-y-6">
        <div className="bg-orange-50 dark:bg-orange-900/20 p-6 rounded-lg border-2 border-orange-200 dark:border-orange-800">
          <h3 className="text-lg font-semibold text-orange-900 dark:text-orange-100 mb-4">👥 Create Bidder Accounts</h3>
          <div className="space-y-3">
            <div className="flex items-start">
              <ChevronRight className="h-5 w-5 text-orange-600 dark:text-orange-400 mr-2 mt-0.5 flex-shrink-0" />
              <span className="text-gray-700 dark:text-gray-300"><strong>Team Name:</strong> e.g., "Mumbai Indians"</span>
            </div>
            <div className="flex items-start">
              <ChevronRight className="h-5 w-5 text-orange-600 dark:text-orange-400 mr-2 mt-0.5 flex-shrink-0" />
              <span className="text-gray-700 dark:text-gray-300"><strong>Username:</strong> Unique identifier for login</span>
            </div>
            <div className="flex items-start">
              <ChevronRight className="h-5 w-5 text-orange-600 dark:text-orange-400 mr-2 mt-0.5 flex-shrink-0" />
              <span className="text-gray-700 dark:text-gray-300"><strong>Purse Amount:</strong> e.g., ₹1,00,00,000</span>
            </div>
            <div className="flex items-start">
              <ChevronRight className="h-5 w-5 text-orange-600 dark:text-orange-400 mr-2 mt-0.5 flex-shrink-0" />
              <span className="text-gray-700 dark:text-gray-300"><strong>Credentials:</strong> Username and password are saved</span>
            </div>
          </div>
        </div>

        <Card className="bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800">
          <CardHeader>
            <CardTitle className="text-lg">💰 Purse Management</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-700 dark:text-gray-300">Initial Purse</span>
                <span className="font-bold text-green-600">₹1,00,00,000</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-700 dark:text-gray-300">Spent</span>
                <span className="font-bold text-red-600">₹45,00,000</span>
              </div>
              <div className="flex justify-between items-center border-t pt-3">
                <span className="font-semibold text-gray-900 dark:text-gray-100">Remaining</span>
                <span className="font-bold text-lg text-blue-600">₹55,00,000</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  },
  {
    id: 'publish',
    title: 'Publish Auction',
    description: 'Make your auction live and accessible',
    icon: <Globe className="h-8 w-8 text-teal-600" />,
    content: (
      <div className="space-y-6">
        <div className="bg-teal-50 dark:bg-teal-900/20 p-6 rounded-lg border-2 border-teal-200 dark:border-teal-800">
          <h3 className="text-lg font-semibold text-teal-900 dark:text-teal-100 mb-4">🌐 Publishing Options</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
              <div className="flex items-center mb-3">
                <Badge className="bg-green-500 mr-2">ENABLED</Badge>
                <span className="font-semibold">Public Registration</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Allow public players to register via auction link</p>
            </div>
            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg">
              <div className="flex items-center mb-3">
                <Badge className="bg-blue-500 mr-2">LIVE</Badge>
                <span className="font-semibold">Publication Status</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Auction becomes visible on your organization page</p>
            </div>
          </div>
        </div>

        <Card className="bg-gradient-to-r from-blue-50 to-teal-50 dark:from-blue-900/20 dark:to-teal-900/20 border-2 border-teal-300 dark:border-teal-700">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="h-5 w-5" />
              After Publishing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-gray-700 dark:text-gray-300">
              <li>✓ Auction appears in public listings</li>
              <li>✓ Players can register (if enabled)</li>
              <li>✓ Share link becomes active</li>
              <li>✓ Ready to start live auction</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    )
  },
  {
    id: 'live',
    title: 'Run Live Auction',
    description: 'Conduct real-time bidding with full control',
    icon: <Zap className="h-8 w-8 text-red-600" />,
    content: (
      <div className="space-y-6">
        <div className="bg-red-50 dark:bg-red-900/20 p-6 rounded-lg border-2 border-red-200 dark:border-red-800">
          <h3 className="text-lg font-semibold text-red-900 dark:text-red-100 mb-4">🎮 Live Auction Controls</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Button size="sm" className="bg-green-600">▶ Start</Button>
                <span className="text-sm">Begin the auction</span>
              </div>
              <div className="flex items-center gap-3">
                <Button size="sm" variant="outline" className="text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800">⏸ Pause</Button>
                <span className="text-sm">Temporarily pause</span>
              </div>
              <div className="flex items-center gap-3">
                <Button size="sm" variant="outline" className="text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800">⏭ Next</Button>
                <span className="text-sm">Move to next player</span>
              </div>
              <div className="flex items-center gap-3">
                <Button size="sm" variant="destructive">⏹ End</Button>
                <span className="text-sm">End auction</span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Button size="sm" className="bg-purple-600">✓ Mark Sold</Button>
                <span className="text-sm">Confirm sale</span>
              </div>
              <div className="flex items-center gap-3">
                <Button size="sm" variant="outline" className="text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800">❌ Mark Unsold</Button>
                <span className="text-sm">Mark as unsold</span>
              </div>
              <div className="flex items-center gap-3">
                <Button size="sm" variant="outline" className="text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800">↶ Undo</Button>
                <span className="text-sm">Undo last bid</span>
              </div>
              <div className="flex items-center gap-3">
                <Button size="sm" variant="outline" className="text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800">↶ Undo Sale</Button>
                <span className="text-sm">Undo last sale</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-blue-200 dark:border-blue-800">
            <CardHeader>
              <CardTitle className="text-base">👥 Admin View</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600 dark:text-gray-400">• See all bidders</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">• Bid on behalf</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">• Full controls</p>
            </CardContent>
          </Card>
          <Card className="border-green-200 dark:border-green-800">
            <CardHeader>
              <CardTitle className="text-base">💰 Bidder View</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600 dark:text-gray-400">• See own purse</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">• Quick bid buttons</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">• Real-time updates</p>
            </CardContent>
          </Card>
          <Card className="border-purple-200 dark:border-purple-800">
            <CardHeader>
              <CardTitle className="text-base">👀 Public View</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600 dark:text-gray-400">• Watch live</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">• See bid history</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">• No bidding</p>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 border-2 border-purple-300 dark:border-purple-700">
          <CardHeader>
            <CardTitle className="text-lg">⚡ Real-Time Features</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-gray-700 dark:text-gray-300">
              <li>✓ Instant bid updates via WebSocket</li>
              <li>✓ Live countdown timer synchronization</li>
              <li>✓ Real-time auction status changes</li>
              <li>✓ Automatic player progression</li>
              <li>✓ Live bid history feed</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    )
  }
]

export default function TutorialPage() {
  const [activeStep, setActiveStep] = useState(0)

  const currentStep = tutorialSteps[activeStep]
  const isFirst = activeStep === 0
  const isLast = activeStep === tutorialSteps.length - 1

  const nextStep = () => {
    if (!isLast) setActiveStep(activeStep + 1)
  }

  const prevStep = () => {
    if (!isFirst) setActiveStep(activeStep - 1)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      {/* Navigation */}
      <nav className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center">
              <Image src="/squady-logo.svg" alt="Squady" width={120} height={40} className="h-8 w-auto" />
            </Link>
            <div className="flex items-center space-x-2 sm:space-x-4">
              <Link href="/register">
                <Button variant="ghost" className="hidden sm:flex text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800">
                  Player Registration
                </Button>
              </Link>
              <Link href="/signin" className="hidden md:block">
                <Button variant="ghost" className="text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800">
                  Sign In
                </Button>
              </Link>
              <Link href="/signup">
                <Button className="text-sm px-3 sm:px-4 bg-blue-600 hover:bg-blue-700 text-white">
                  <span className="hidden sm:inline">Get Started</span>
                  <span className="sm:hidden">Start</span>
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Tutorial Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {/* Header */}
        <div className="text-center mb-8 sm:mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full mb-4">
            <BookOpen className="h-8 w-8 text-blue-600 dark:text-blue-400" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
            Squady Auction Tutorial
          </h1>
          <p className="text-base sm:text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Learn how to create and run professional sports auctions from start to finish
          </p>
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Step {activeStep + 1} of {tutorialSteps.length}
            </span>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {Math.round(((activeStep + 1) / tutorialSteps.length) * 100)}% Complete
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <motion.div
              className="bg-gradient-to-r from-blue-600 to-purple-600 h-2 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${((activeStep + 1) / tutorialSteps.length) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>

        {/* Step Navigation Tabs */}
        <div className="mb-8 overflow-x-auto">
          <div className="flex gap-2 pb-2 min-w-max">
            {tutorialSteps.map((step, index) => (
              <button
                key={step.id}
                onClick={() => setActiveStep(index)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                  index === activeStep
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {step.icon}
                <span className="hidden sm:inline ml-2">{step.title}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <motion.div
          key={activeStep}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
        >
          <Card className="mb-8">
            <CardHeader>
              <div className="flex items-center gap-4">
                {currentStep.icon}
                <div>
                  <CardTitle className="text-2xl">{currentStep.title}</CardTitle>
                  <p className="text-gray-600 dark:text-gray-400 mt-1">{currentStep.description}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>{currentStep.content}</CardContent>
          </Card>
        </motion.div>

        {/* Navigation Buttons */}
        <div className="flex justify-between items-center gap-4">
          <Button
            onClick={prevStep}
            disabled={isFirst}
            variant="outline"
            className="flex items-center gap-2 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Previous
          </Button>

          <div className="hidden sm:flex gap-2">
            {tutorialSteps.map((step, index) => (
              <button
                key={step.id}
                onClick={() => setActiveStep(index)}
                className={`w-2 h-2 rounded-full transition-all ${
                  index === activeStep
                    ? 'bg-blue-600 w-8'
                    : 'bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500'
                }`}
              />
            ))}
          </div>

          <Button
            onClick={nextStep}
            disabled={isLast}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white"
          >
            Next
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Help Section */}
        <Card className="mt-12 border-blue-200 dark:border-blue-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-blue-600" />
              Need More Help?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Ready to start your first auction? Follow the steps above or contact our support team for assistance.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link href="/signup">
                <Button className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white">
                  Start Creating Auctions
                </Button>
              </Link>
              <Link href="/signin">
                <Button variant="outline" className="w-full sm:w-auto text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700">
                  Sign In to Continue
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Footer */}
      <footer className="bg-gray-900 dark:bg-black text-white py-8 px-4 mt-16">
        <div className="max-w-7xl mx-auto text-center">
          <p>&copy; 2024 Squady. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}

