# PCBA Ordering Guide

This guide provides step-by-step instructions for ordering Stack-chan boards using JLCPCB's PCBA service.

## What are PCB and PCBA?

**PCB (Printed Circuit Board)** is a bare board with printed circuit patterns. You receive the board without components and need to solder all parts yourself.

**PCBA (Printed Circuit Board Assembly)** is a fully assembled board delivered with all components already soldered. This means you can use it immediately upon arrival. It eliminates the need for tedious SMD (Surface Mount Device) soldering work, making the build process much easier.

## About Stack-chan Board

The Stack-chan board (m5-pantilt) is a servo control board designed to work with M5Stack. It features:

### Main Features

* **Servo Motor Control**: Drive two servo motors
  * PWM method (2 channels) or Serial communication method (2 channels)
* **M5Unit PortB**: Expansion port for M5Stack units
* **Power Management**:
  * External 5V power input
  * Battery connection (chargeable via M5Stack)
  * Optional power switch mounting
* **Compact Design**: Sized to mount directly onto M5Stack

### Board Specifications

* **Size**: M5Stack compatible dimensions
* **Layers**: 2-layer board
* **Thickness**: 1.6mm
* **Surface Finish**: HASL (standard)

## Downloading Gerber Files

This repository uses GitHub Actions to automatically generate a complete set of Gerber files for JLCPCB.

### Download Steps

1. **Access GitHub Actions Page**
   - Click the "Actions" tab from the repository top page
   - Or directly access https://github.com/stack-chan/stack-chan/actions

2. **Select Workflow Run**
   - Click "Generate Stack-chan Schematics Files" in the left sidebar
   - Select the latest successful run (green checkmark ✓)

3. **Download Artifacts**
   - Find the "Artifacts" section at the bottom of the page
   - Click "schematics-files" to download the ZIP file

4. **Extract Files**
   - Extract the downloaded ZIP file
   - Inside the `Manufacturers/JLCPCB/` folder, you'll find:
     - Complete Gerber files (ZIP file)
     - BOM (Bill of Materials) - CSV file
     - CPL (Component Placement List) - CSV file

## JLCPCB PCBA Ordering Steps

### Step 1: Prepare JLCPCB Account

1. Access [JLCPCB](https://jlcpcb.com/)
2. Register for a new account if you don't have one

### Step 2: Upload Board Data

1. Click "Order Now" on JLCPCB homepage
2. Click the "Add gerber file" button
3. Upload the Gerber ZIP file from the downloaded `Manufacturers/JLCPCB/` folder
   - File name is typically like `m5-pantilt-gerbers.zip`

### Step 3: Verify/Configure Board Specifications

After upload, board specifications are automatically detected. Verify the following:

#### Basic Specifications
- **Base Material**: FR-4
- **Layers**: 2
- **Dimensions**: Verify the auto-detected values
- **PCB Qty**: Select desired quantity (minimum 5 boards)
- **Product Type**: Industrial/Consumer electronics

#### Board Parameters
- **PCB Thickness**: 1.6 mm
- **PCB Color**: Choose preferred color (green is standard, black/white/blue/red also available)
- **Silkscreen**: White (adjustable based on board color)
- **Surface Finish**: HASL(with lead) or LeadFree HASL
  - LeadFree HASL recommended (lead-free)
- **Outer Copper Weight**: 1 oz

#### Other Settings (usually defaults are fine)
- **Gold Fingers**: No
- **Confirm Production file**: No (unchecked is fine)
- **Flying Probe Test**: Fully Test (recommended)
- **Castellated Holes**: No
- **Remove Order Number**: Specify a location (order number will be printed at any location on the board)

### Step 4: Select PCBA Service

1. Turn **ON** the "PCB Assembly" toggle switch below board specifications
2. Select PCBA Type:
   - **Economic**: Single-sided assembly, lower cost
   - **Standard**: Supports double-sided assembly
   
   For Stack-chan board with components on one side only, **Economic** is sufficient

3. Select Assembly Side:
   - **Top Side**: Assemble top surface only
   - **Bottom Side**: Assemble bottom surface only
   
   Choose according to your board design (usually Top Side)

4. Select PCBA Qty (assembly quantity):
   - Minimum 2 boards (must be equal to or less than PCB order quantity)

5. Click **Confirm** button

### Step 5: Upload BOM and CPL Files

1. Click "Next" on the following page

2. **Upload BOM File**
   - Click "Add BOM File"
   - Upload `m5-pantilt-bom-jlc.csv` from the downloaded folder

3. **Upload CPL File**
   - Click "Add CPL File"
   - Upload `m5-pantilt-cpl-jlc.csv` from the downloaded folder

4. Click "Process BOM & CPL" button

### Step 6: Verify Components

1. After BOM & CPL processing completes, the component list will be displayed

2. Verify for each component:
   - **JLCPCB Part #**: JLCPCB part numbers are automatically matched
   - **Stock**: Confirm sufficient inventory
   - **Component Placement**: Check component positions in preview image

3. If warnings or errors appear:
   - Out-of-stock components: Select alternatives or wait for restock
   - Unmatched components: Manually search and select appropriate parts

4. Once all components are verified, click "Next"

### Step 7: Final Placement Verification

1. Visually verify component placement on the board
2. Confirm correct orientation and position of each component
3. If no issues, click "Next"

### Step 8: Quote and Order

1. Select production time:
   - Standard: Normal delivery (lower cost)
   - Express: Urgent cases (additional fee)

2. Select shipping method:
   - Enter shipping address
   - Choose shipping option (regular or express)

3. Review pricing:
   - PCB manufacturing cost
   - PCBA assembly cost
   - Component cost
   - Shipping cost
   - Total amount

4. **Save to Cart** to add to cart, or **Save to Cart & Checkout** to proceed directly to payment

### Step 9: Payment and Manufacturing Start

1. Final verification at cart screen
2. Select payment method (credit card, PayPal, etc.)
3. Confirm order

After ordering, JLCPCB engineers will review the design files. If there are any issues, they will contact you, so please check your email.

## Ordering Considerations

### To Reduce Costs

- Green board color is cheapest
- Quantities of 5 or 10 boards offer best cost-performance
- HASL surface finish is cheapest, but LeadFree HASL has small price difference

### Components Requiring Manual Soldering

The PCBA service may not assemble the following (depending on design):

- Through-hole components (pin headers, connectors, etc.)
- Some large components
- Special components

These need to be hand-soldered after board arrival. Refer to GitHub Pages or [../README.md](../README.md) for the list of additional required components.

## Troubleshooting

### Q: BOM file errors
A: Verify CSV file format is correct. If modifying in Excel, save in UTF-8 format.

### Q: Some components out of stock
A: You can search for alternatives on JLCPCB. Select components with same specifications. If unsure, ask in Issues.

### Q: Placement looks wrong
A: CPL file coordinate system might be incorrect. Please report in GitHub Issues.

### Q: Price is too high
A: Check the following:
- Are components "Extended Parts"? (Basic Parts or Preferred Parts are cheaper)
- Is quantity appropriate? (2 boards can be more expensive than 5 boards)

## Support

If you have questions or issues, you can get support through:

- **GitHub Issues**: https://github.com/stack-chan/stack-chan/issues
- **Discord**: Stack-chan Community
- **Official Documentation**: README files in this repository

## Reference Links

- [JLCPCB PCBA Service](https://jlcpcb.com/pcb-assembly)
- [JLCPCB Help Center](https://support.jlcpcb.com/)
- [Stack-chan GitHub Pages](https://stack-chan.github.io/stack-chan/)
- [Board Assembly Instructions](../README.md)
