// Sample documents. All are fictional: the insurer, the municipality, the medicine and the school do not exist.

export interface Sample {
  id: string;
  label: string;
  description: string;
  filename: string;
  tone: 'neutral' | 'reassuring' | 'urgent';
  protectedTerms: string[];
  text: string;
}

export const SAMPLES: Sample[] = [
  {
    id: 'insurance',
    label: 'Insurance policy update',
    description: 'Premium change, deadline, exception, warning',
    filename: 'northwind-policy-update.txt',
    tone: 'neutral',
    protectedTerms: ['Northwind Mutual', 'Dental Plus'],
    text: `NORTHWIND MUTUAL HEALTH INSURANCE
Important changes to your policy (policy number NM-2207-4419)
Date: 1 October 2026

Dear Policyholder,

We are writing to tell you about changes to your health insurance policy that take effect from 1 January 2027.

Your monthly premium will increase from EUR 84.00 to EUR 92.40, an increase of 10%. This increase does not apply to policyholders who are aged 70 or over on 1 January 2027; their premium will remain at the current amount.

The annual deductible will rise from EUR 250 to EUR 300. After the deductible has been reached, we will reimburse 80% of eligible outpatient costs, unless the treatment was received outside the approved provider network, in which case we will reimburse 50%.

You must submit your updated contact and bank details through the member portal or by post no later than 25 October 2026. If we do not receive your updated details by this date, your cover may be suspended from 1 January 2027 until the details are received.

Dental treatment will no longer be covered under the standard plan from 1 January 2027. If you wish to keep dental cover, you must add the Dental Plus option before 30 November 2026, at an additional cost of EUR 12.50 per month.

Warning: claims for treatment received during a period of suspension will not be reimbursed.

If you disagree with these changes, you may cancel your policy without penalty by writing to us within 30 days of the date of this letter. If you have questions, call our member line on 0800 555 0177, Monday to Friday, 8:00 to 18:00.`,
  },
  {
    id: 'tax',
    label: 'Tax notice',
    description: 'Amounts owed, instalments, appeal rights',
    filename: 'portovale-tax-notice.txt',
    tone: 'neutral',
    protectedTerms: ['TARI', 'Provincial Tax Court'],
    text: `MUNICIPALITY OF PORTOVALE, REVENUE OFFICE
NOTICE OF ASSESSMENT AND DEMAND FOR PAYMENT
Reference: TX-2026-00418. Date of issue: 2 October 2026.

Dear Taxpayer,

Following a review of the municipal waste services tax (TARI) account for the property at Via dei Mille 14, the Revenue Office has determined that the amount paid for the 2025 tax year was insufficient. The outstanding balance is EUR 386.40, comprising EUR 342.00 in unpaid tax, a late-payment surcharge of EUR 34.20 and accrued statutory interest of EUR 10.20.

Payment of the full amount must be received no later than 1 December 2026. Payment may be made by bank transfer, quoting the reference number above, or in person at the Revenue Office, Piazza del Comune 3, Monday to Thursday between 8:30 and 12:30.

If you are unable to pay the full amount by the due date, you may apply to pay in up to 6 monthly instalments. The application must be submitted in writing before 15 November 2026 and is subject to approval. Instalment plans are not available for balances below EUR 100.00.

If you believe this assessment is incorrect, you have the right to lodge an appeal with the Provincial Tax Court within 60 days of receipt of this notice. Lodging an appeal does not suspend the obligation to pay unless the Court orders otherwise.

Failure to pay or to apply for an instalment plan by the due date will result in an additional penalty of 30% of the unpaid tax and the commencement of enforced collection proceedings without further notice.

For assistance, contact the Revenue Office on 010 555 0199, quoting your reference number.`,
  },
  {
    id: 'leaflet',
    label: 'Medicine leaflet',
    description: 'Doses, maximums, warnings',
    filename: 'lumetrol-leaflet.txt',
    tone: 'reassuring',
    protectedTerms: ['Lumetrol', 'lumetrazole', 'warfarin', 'penicillin'],
    text: `PACKAGE LEAFLET: INFORMATION FOR THE PATIENT
Lumetrol 500 mg film-coated tablets (lumetrazole)

Read all of this leaflet carefully before you start taking this medicine because it contains important information for you.

Lumetrol contains the active substance lumetrazole, an antibacterial agent indicated for the treatment of bacterial infections of the respiratory tract in adults and adolescents aged 12 years and over.

Do not take Lumetrol if you are allergic to lumetrazole or to penicillin. Lumetrol is contraindicated in patients with severe hepatic impairment. Concomitant consumption of alcohol must be avoided during treatment and for 48 hours after the final dose. Inform your physician prior to commencing treatment if you are pregnant, breast-feeding, or taking anticoagulant medication such as warfarin.

The recommended dose is 1 tablet (500 mg) twice daily, administered every 12 hours with food. Do not exceed 2 tablets (1000 mg) in any 24-hour period. Swallow the tablet whole with a glass of water; do not crush or chew it. The duration of treatment is 7 days. You must complete the full course even if your symptoms improve after 2 or 3 days.

Common side effects, which may affect up to 1 in 10 people, include nausea, diarrhoea and headache. Discontinue treatment and seek immediate medical attention if you develop a skin rash, swelling of the face or throat, or difficulty breathing.

Store below 25 °C in the original packaging. Keep this medicine out of the sight and reach of children. If your symptoms have not improved after 3 days, consult your physician.`,
  },
  {
    id: 'school',
    label: 'School trip letter',
    description: 'Payments, forms, dates',
    filename: 'riverbend-school-trip.txt',
    tone: 'neutral',
    protectedTerms: ['Calder Water Outdoor Centre', 'Mrs Okafor'],
    text: `RIVERBEND PRIMARY SCHOOL
Year 5 Residential Visit to Calder Water Outdoor Centre: Information for Parents and Carers

Year 5 pupils will attend a residential visit to Calder Water Outdoor Centre from Wednesday 12 May to Friday 14 May 2027. The coach will depart from the school car park at 8:15 on Wednesday; pupils must arrive no later than 8:00.

The cost of the visit is £95 per pupil, which covers transport, accommodation, meals and all activities. A non-refundable deposit of £20 is due by 26 February 2027, with the remaining balance of £75 payable by 16 April 2027. Families in receipt of free school meals may apply for a subsidy of up to £60 by contacting the school office in confidence.

The signed consent form and the medical information form must be returned by 12 March 2027. Pupils without a completed consent form will not be permitted to travel. Any prescribed medication must be handed to Mrs Okafor in its original packaging, clearly labelled with the pupil's name and dosage instructions.

Pupils must not bring mobile phones, electronic devices or more than £5 of pocket money. A full kit list will be sent home 2 weeks before departure. If you have any questions, please contact the school office on 01632 960 114.`,
  },
];

export const sampleById = (id: string) => SAMPLES.find((s) => s.id === id);
