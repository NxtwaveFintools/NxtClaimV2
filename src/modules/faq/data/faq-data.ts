export type FaqItem = {
  id: number;
  category: string;
  question: string;
  answer: string;
};

export const faqData: FaqItem[] = [
  {
    id: 1,
    category: "General",
    question: "What documents are required for reimbursement?",
    answer:
      "Original invoice/receipt + payment proof (bank statement, UPI confirmation, or digital receipt). For overseas subscriptions, you also need a bank statement showing payment in Indian Rupees (INR) that matches the invoice amount.",
  },
  {
    id: 2,
    category: "General",
    question: "Can I submit multiple expenses in a single reimbursement request?",
    answer:
      "No, each claim must contain a single expense. Multiple expenses must be submitted as separate claims.",
  },
  {
    id: 3,
    category: "General",
    question: "Where can I check the claim rejection reason?",
    answer:
      "Check claim status in My Submissions. Navigate to Claims > My Submissions, click on the specific claim to view rejection notes and details.",
  },
  {
    id: 4,
    category: "General",
    question: "Do I need to submit receipts after using petty cash?",
    answer:
      "Yes, you must settle petty cash advances within 3 working days by submitting original invoices/receipts, payment proof, and reconciliation through NxtClaim.",
  },
  {
    id: 5,
    category: "General",
    question: "Can I request additional petty cash before settling a previous advance?",
    answer: "No. You must settle all previous petty cash expenses before requesting a new advance.",
  },
  {
    id: 6,
    category: "General",
    question: "What types of expenses can be covered through petty cash?",
    answer: "Food, fuel, travel and accommodation.",
  },
  {
    id: 7,
    category: "General",
    question: "Can I submit proforma invoices?",
    answer:
      "No, only tax invoices are accepted. Proforma invoices are not permitted under company policy.",
  },
  {
    id: 8,
    category: "General",
    question: "Can I submit duplicate invoices?",
    answer: "No, duplicate invoices are strictly not allowed and will be rejected automatically.",
  },
  {
    id: 9,
    category: "General",
    question: "What documents are mandatory?",
    answer:
      "Invoice/receipt (original) + payment proof. For overseas subscriptions, bank statement showing INR payment matching invoice is also required.",
  },
  {
    id: 10,
    category: "General",
    question: "Can I edit my claim after approval?",
    answer:
      "No, claims cannot be edited after submission. Ensure all information is accurate and complete before submitting the claim.",
  },
  {
    id: 11,
    category: "General",
    question: "Which bank account will receive the payment for my reimbursement?",
    answer: "Reimbursements are credited to your registered bank account on file with the company.",
  },
  {
    id: 12,
    category: "General",
    question: "Can I submit expenses on behalf of another employee?",
    answer:
      "Yes, via 'On Behalf' submission. You must provide the employee's email address and Employee ID.",
  },
  {
    id: 13,
    category: "General",
    question: "Can I claim birthday celebration expenses?",
    answer: "No, we don't have a policy for birthday celebration claims.",
  },
  {
    id: 14,
    category: "General",
    question: "How do approval workflows work in NxtClaim?",
    answer: "Submitted → HOD Approved → Finance Approved → Payment Done.",
  },
  {
    id: 15,
    category: "General",
    question: "Can I view my previous reimbursement and petty cash history?",
    answer: "Yes, via Dashboard > Claims > My Submissions.",
  },
  {
    id: 16,
    category: "General",
    question: "How do I search for a specific claim?",
    answer:
      "Use Claim ID or filters in My Submissions (Submission Type, Payment Mode, Department, Location, Product, Expense Category, Status, Date Range).",
  },
  {
    id: 17,
    category: "General",
    question: "Who can approve my requests?",
    answer:
      "HOD provides first-level approval, then Finance team provides final approval before payment.",
  },
  {
    id: 18,
    category: "General",
    question: "How do I contact the NxtClaim support team?",
    answer:
      "Contact mohammed.umanuddin@nxtwave.co.in (NW0005498) for technical support and platform-related issues.",
  },
  {
    id: 19,
    category: "General",
    question: "What is the payment turnaround time (TAT) after HOD approval?",
    answer:
      "Payment is credited to your registered bank account within T+7 Finance Working Days after HOD approval.",
  },
  {
    id: 20,
    category: "General",
    question: "What are the submission deadlines for reimbursement claims?",
    answer:
      "Expenses incurred 1st-15th: Submit by 18th of same month. Expenses incurred 16th-31st: Submit by 3rd of following month. Petty Cash: Settle within 3 working days from spend.",
  },
  {
    id: 21,
    category: "General",
    question: "What is the maximum single reimbursement amount allowed?",
    answer:
      "No single reimbursement request can exceed ₹10,000. Amounts exceeding this limit must be processed through alternative channels.",
  },
  {
    id: 22,
    category: "General",
    question: "How is petty cash disbursed?",
    answer:
      "Petty cash is issued exclusively via Volopay digital wallet. It will NOT be transferred to your personal bank account.",
  },
  {
    id: 23,
    category: "General",
    question: "What are the eligible expense categories?",
    answer: "Food, travel (fuel/local transport), Accommodation and subscriptions (overseas).",
  },
  {
    id: 24,
    category: "General",
    question: "What information must be included in a Cash Memo if I don't have an invoice?",
    answer:
      "Detailed business purpose, complete explanation, transaction date, employee details, HOD's signature (mandatory), and payment proof (bank statement) as attachment.",
  },
  {
    id: 25,
    category: "General",
    question: "Which platform must I use for travel bookings?",
    answer:
      "All business-related travel and hotel bookings must be made exclusively through Make My Trip MyBiz. Claims from other platforms may be rejected.",
  },
  {
    id: 26,
    category: "General",
    question: "What are the travel reimbursement limits by role and city tier?",
    answer:
      "Varies by role and city tier. Example: Associates/Managers - Tier 1: ₹4,500/night, Tier 2: ₹3,500/night, Tier 3: ₹2,500/night. Daily food allowance: ₹1,200. Own vehicle: 2W: ₹6/km, 4W: ₹13/km.",
  },
  {
    id: 27,
    category: "General",
    question: "What happens if I don't settle petty cash within the deadline?",
    answer:
      "Non-compliance with submission deadlines may result in salary hold and will be considered during performance appraisals, potentially impacting variable pay or increments.",
  },
  {
    id: 28,
    category: "General",
    question: "Can I raise a grievance if I disagree with a claim rejection?",
    answer:
      "Yes, you can write to pay@nxtwave.tech with your Employee ID, Claim ID, and details of the issue. Finance team will respond within 5 working days.",
  },
  {
    id: 29,
    category: "General",
    question: "What is the role of my HOD in the expense approval process?",
    answer:
      "HOD reviews claims for business validity and policy compliance, ensures complete and accurate documentation, provides timely approval/return, and signs cash memos when required.",
  },
  {
    id: 30,
    category: "General",
    question: "I have a food bill. Should I attach the payment proof?",
    answer:
      "You can proceed with your claim by attaching the original invoice/receipt. Transaction proof is not required for Food expense claims.",
  },
  {
    id: 31,
    category: "General",
    question: "I have a bill but I don't have transaction proof. Can I still submit?",
    answer:
      "You may proceed with your claim by attaching the original invoice/receipt. If you require further assistance, please raise a ticket, and the Finance team will reach out to you.",
  },
  {
    id: 32,
    category: "General",
    question: "Can I raise a claim request in foreign currency?",
    answer:
      "Yes, you can raise a claim request in a foreign currency. Please ensure that you attach the required supporting documents based on the selected expense category.",
  },
  {
    id: 33,
    category: "General",
    question: "At the time of the request, what amount should I put?",
    answer:
      "Please enter the claim amount in Indian Rupees (INR). The amount entered should match the amount reflected in your bank/payment proof to ensure accurate claim processing.",
  },
  {
    id: 34,
    category: "General",
    question: "I have a USD ($) currency invoice. What amount should I submit — $ or INR?",
    answer:
      "Please submit the claim amount in Indian Rupees (INR). If your invoice is in a foreign currency (e.g., USD), enter the equivalent amount in INR. The INR amount should match the amount reflected in your bank/payment proof, where applicable.",
  },
  {
    id: 35,
    category: "General",
    question: "For accommodation bills, can we provide the company details in the invoice?",
    answer:
      "Please do not provide the company's GST details on accommodation invoices. Submit the invoice with the required supporting documents as per the reimbursement policy.",
  },
  {
    id: 36,
    category: "General",
    question: "Can we give the company name but not provide the GST number?",
    answer:
      "Yes, you may provide the company name on the invoice. However, please do not provide the company's GST number.",
  },
  {
    id: 37,
    category: "General",
    question: "Can I request reimbursement for assets?",
    answer:
      "No. Petty Cash Reimbursement claims cannot be submitted for asset purchases. Please follow the company's asset procurement process for such purchases.",
  },
  {
    id: 38,
    category: "General",
    question:
      "Can I claim flight tickets for reimbursement, or can I use petty cash for flight ticket bookings?",
    answer:
      "As per company policy, all flight ticket bookings must be made exclusively through Make My Trip MyBiz. Flight ticket expenses booked outside MyBiz are not eligible for reimbursement or petty cash.",
  },
  {
    id: 39,
    category: "General",
    question: "I have an invoice above ₹10,000. Is payment proof required?",
    answer:
      "Yes. Payment proof is mandatory for all transactions above ₹10,000. Please attach the original invoice/receipt along with the payment proof. Additionally, no single petty cash or reimbursement request may exceed ₹10,000 through these channels.",
  },
  {
    id: 40,
    category: "General",
    question: "Can I get local subscriptions through petty cash?",
    answer:
      "No. Local Subscription expenses cannot be requested through petty cash or reimbursement. A Purchase Requisition (PR) must be raised for all Local Subscription purchases as per company policy.",
  },
  {
    id: 41,
    category: "General",
    question: "I have an invoice for ₹6,000 but I paid ₹7,000. How can I request ₹7,000?",
    answer:
      "You can claim only the amount supported by a valid invoice. If your invoice is for ₹6,000 but you paid ₹7,000, only the invoiced amount is eligible for reimbursement. If the amount paid differs from the invoice amount, the vendor name and transaction date on the invoice must match the payment proof.",
  },
  {
    id: 42,
    category: "General",
    question: "I paid a Rapido partner over the ride amount. How can I request the claim?",
    answer:
      "You can claim only the actual ride fare supported by the Rapido invoice/receipt. Any additional amount paid directly to the Rapido partner that is not reflected in the invoice/receipt is not eligible for claim submission.",
  },
  {
    id: 43,
    category: "General",
    question: "Can I use the Team Outing petty cash amount for other activities?",
    answer:
      "No. Team Outing petty cash must be used only for the approved team outing expenses. It cannot be used for any other activities or purposes.",
  },
];
