'use client'

import { useEffect, useState } from 'react'
import { initializePusher } from '@/lib/pusher-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export default function TestPusherPage() {
  const [connectionState, setConnectionState] = useState<string>('initializing')
  const [events, setEvents] = useState<Array<{ time: string; event: string; data: any }>>([])
  const [testChannelId, setTestChannelId] = useState('')

  useEffect(() => {
    const pusher = initializePusher()
    
    // Monitor connection state
    setConnectionState(pusher.connection.state)
    
    pusher.connection.bind('state_change', (states: any) => {
      console.log('State changed:', states)
      setConnectionState(states.current)
      addEvent('connection-state', `${states.previous} → ${states.current}`)
    })
    
    pusher.connection.bind('connected', () => {
      addEvent('connection', 'Connected to Pusher ✅')
    })
    
    pusher.connection.bind('disconnected', () => {
      addEvent('connection', 'Disconnected from Pusher ❌')
    })
    
    pusher.connection.bind('error', (err: any) => {
      addEvent('connection', `Error: ${err.error?.message || JSON.stringify(err)}`)
    })
    
    return () => {
      pusher.connection.unbind_all()
    }
  }, [])
  
  const addEvent = (event: string, data: any) => {
    const time = new Date().toLocaleTimeString()
    setEvents(prev => [{ time, event, data }, ...prev].slice(0, 50))
  }
  
  const subscribeToAuction = () => {
    if (!testChannelId) {
      alert('Please enter an auction ID')
      return
    }
    
    const pusher = initializePusher()
    const channelName = `auction-${testChannelId}`
    const channel = pusher.subscribe(channelName)
    
    addEvent('subscription', `Subscribing to ${channelName}`)
    
    channel.bind('pusher:subscription_succeeded', () => {
      addEvent('subscription', `✅ Subscribed to ${channelName}`)
    })
    
    channel.bind('pusher:subscription_error', (error: any) => {
      addEvent('subscription', `❌ Subscription error: ${JSON.stringify(error)}`)
    })
    
    // Bind to all auction events
    const eventNames = [
      'new-bid',
      'bid-undo',
      'player-sold',
      'sale-undo',
      'new-player',
      'timer-update',
      'auction-paused',
      'auction-resumed',
      'auction-ended',
      'players-updated',
      'bid-error'
    ]
    
    eventNames.forEach(eventName => {
      channel.bind(eventName, (data: any) => {
        addEvent(eventName, data)
      })
    })
  }
  
  const getConnectionBadge = () => {
    switch (connectionState) {
      case 'connected':
        return <Badge className="bg-green-500">Connected ✅</Badge>
      case 'connecting':
        return <Badge className="bg-yellow-500">Connecting...</Badge>
      case 'disconnected':
        return <Badge className="bg-red-500">Disconnected ❌</Badge>
      case 'unavailable':
        return <Badge className="bg-red-500">Unavailable</Badge>
      case 'failed':
        return <Badge className="bg-red-500">Failed ❌</Badge>
      default:
        return <Badge className="bg-gray-500">{connectionState}</Badge>
    }
  }
  
  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <h1 className="text-3xl font-bold mb-6">Pusher Connection Diagnostic</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle>Connection Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <strong>State:</strong> {getConnectionBadge()}
              </div>
              <div>
                <strong>App Key:</strong>{' '}
                <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                  {process.env.NEXT_PUBLIC_PUSHER_KEY}
                </code>
              </div>
              <div>
                <strong>Cluster:</strong>{' '}
                <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                  {process.env.NEXT_PUBLIC_PUSHER_CLUSTER}
                </code>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Test Auction Channel</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <input
                type="text"
                value={testChannelId}
                onChange={(e) => setTestChannelId(e.target.value)}
                placeholder="Enter Auction ID"
                className="w-full px-3 py-2 border rounded"
              />
              <Button onClick={subscribeToAuction} className="w-full">
                Subscribe to Auction
              </Button>
              <p className="text-xs text-gray-500">
                Enter an auction ID and click subscribe to monitor real-time events
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Event Log ({events.length})</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEvents([])}
          >
            Clear Log
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {events.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                No events yet. Subscribe to an auction channel to see events.
              </p>
            ) : (
              events.map((event, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-gray-50 rounded border border-gray-200 text-sm font-mono"
                >
                  <div className="flex items-start justify-between mb-1">
                    <span className="font-bold text-blue-600">{event.event}</span>
                    <span className="text-gray-500 text-xs">{event.time}</span>
                  </div>
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap overflow-auto">
                    {typeof event.data === 'string'
                      ? event.data
                      : JSON.stringify(event.data, null, 2)}
                  </pre>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

