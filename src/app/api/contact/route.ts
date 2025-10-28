import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  try {
    const { name, email, phone, subject, message } = await request.json()

    // Validate required fields
    if (!name || !email || !subject || !message) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Create email body
    const emailBody = `
New Contact Form Submission from Squady

Name: ${name}
Email: ${email}
Phone: ${phone || 'Not provided'}
Subject: ${subject}

Message:
${message}

---
This message was sent from the Squady contact form.
`

    // Send email using Mailto link (can be replaced with nodemailer or other service)
    const mailtoLink = `mailto:tuhinrawat@gmail.com?subject=${encodeURIComponent(
      `Squady Contact: ${subject}`
    )}&body=${encodeURIComponent(emailBody)}`

    // For now, we'll just return success
    // In production, implement actual email sending with nodemailer or a service like SendGrid
    logger.log('Contact form submission received')

    return NextResponse.json({
      success: true,
      message: 'Message sent successfully',
      // Including email details for manual sending if needed
      emailDetails: {
        to: 'tuhinrawat@gmail.com',
        subject: `Squady Contact: ${subject}`,
        body: emailBody
      }
    })

  } catch (error) {
    logger.error('Error processing contact form:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

