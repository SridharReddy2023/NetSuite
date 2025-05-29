/**
 *@NApiVersion 2.1
 *@NScriptType ScheduledScript
 */
define(['N/email', 'N/search', 'N/record', 'N/runtime'], function (email, search, record, runtime) {
    function execute(context) {
        try {
            var invIds = JSON.parse(runtime.getCurrentScript().getParameter({ name: 'custscript_sn_inv_ids' }));
            // Search for invoices pending approval
            var invoiceSearchObj = search.create({
                type: "invoice",
                filters:
                    [
                        ["type", "anyof", "CustInvc"],
                        "AND",
                        ["mainline", "is", "T"],
                        "AND",
                        ["internalid", "anyof", invIds]
                    ],
                columns:
                    [
                        search.createColumn({ name: "internalid", label: "Internal ID" }),
                        search.createColumn({ name: "nextapprover", label: "Next Approver" }),
                        search.createColumn({ name: "tranid", label: "Document Number" }),
                        search.createColumn({ name: "fxamount", label: "Amount (Transaction Total)" }),
                        search.createColumn({ name: "currency", label: "Currency" }),
                        search.createColumn({ name: "entity", label: "Name" }),
                        search.createColumn({ name: "memo", label: "Memo" }),
                        search.createColumn({ name: "postingperiod", label: "Posting Period" })
                    ]
            });
            var searchResultCount = invoiceSearchObj.runPaged().count;
            log.debug("invoice result count", searchResultCount);

            var approverInvoices = {}; // Group invoices by approver
            var errEmailRecipientCC = ["chenzi.qian@smartnews.com", "sherilyn.felisilda@smartnews.com"];

            // Collect invoices and group by next approver
            invoiceSearchObj.run().each(function (result) {
                var approverId = result.getValue('nextapprover');
                if (!approverInvoices[approverId]) {
                    approverInvoices[approverId] = [];
                    var empObj = search.lookupFields({
                        type: "employee",
                        id: approverId,
                        columns: "altname"
                    });
                    log.debug("empObj", empObj);
                    var nextAppName = empObj.altname;
                }
                approverInvoices[approverId].push({
                    id: result.getValue('internalid'),
                    tranid: result.getValue('tranid'),
                    total: result.getValue('fxamount'),
                    nextAppName: nextAppName,
                    currencyName: result.getText('currency'),
                    customerName: result.getText('entity'),
                    memo: result.getValue('memo'),
                    adjMonth: convertPostingPeriod(result.getText('postingperiod'))
                });
                return true;
            });
            log.debug("approverInvoices", approverInvoices);
            // Send consolidated email to each approver
            for (var approverId in approverInvoices) {
                var invoices = approverInvoices[approverId];
                var emailBody = generateEmailBody(approverId, invoices);
                log.debug("approverId", approverId);
                email.send({
                    author: 611884, // Default system email611884
                    recipients: approverId,
                    cc: errEmailRecipientCC,
                    subject: 'Pending Invoice Approvals',
                    body: emailBody
                });
            }
        } catch (error) {
            log.debug("error", error);
        }
    }

    function generateEmailBody(approverId, invoices) {
        var baseSuiteletUrl = 'https://5227949.extforms.netsuite.com/app/site/hosting/scriptlet.nl?script=2511&deploy=1&compid=5227949&ns-at=AAEJ7tMQp3ub4e-g7Odxc8FHiY1MIGwRy0e0ppn3sU84l_zBXBw';
        var tableStyle = 'border: 1px solid #ddd; padding: 8px;';

        // Get the next approver's name from the invoices array (assuming all invoices belong to the same approver)
        var nextAppName = invoices[0]?.nextAppName || 'Approver';

        // Start of email content
        var emailContent = `
            Dear ${nextAppName},<br>
        
            You have the following invoices pending approval:<br>
            <br>
            <table style="border-collapse: collapse; width: 100%; text-align: left;">
                <thead>
                    <tr>
                        <th style="${tableStyle}">Invoice ID</th>
                        <th style="${tableStyle}">Customer</th>
                        <th style="${tableStyle}">Description</th>
                        <th style="${tableStyle}">Item</th>
                        <th style="${tableStyle}">Amount</th>
                        <th style="${tableStyle}">Approve</th>
                        <th style="${tableStyle}">Reject</th>
                    </tr>
                </thead>
                <tbody>
        `;

        // Add rows for each invoice
        invoices.forEach(function (invoice) {
            try {
                var invObj = record.load({
                    type: record.Type.INVOICE,
                    id: invoice.id
                });
                var adBusinessTeam = invObj.getValue({ fieldId: "custbody_ad_business_team_sales" });
                // Check if any line item has item == sitm28
                var hasSitm28 = false;
                var hasSitm026 = false;
                var hasSitm020 = false;
                var hasSitm021 = false;
                for (var i = 0; i < invObj.getLineCount({ sublistId: 'item' }); i++) {
                    var lineItemNameCheck = invObj.getSublistText({
                        sublistId: 'item',
                        fieldId: 'item',
                        line: i
                    });
                    log.debug("lineItemNameCheck", lineItemNameCheck);
                    if (lineItemNameCheck == 'slitm-028 APAC_first_party_sales') {
                        hasSitm28 = true;
                        break;
                    }
                    if (lineItemNameCheck == 'slitm-026 US_first_party_sales') {
                        hasSitm026 = true;
                        break;
                    }
                    if (lineItemNameCheck == 'slitm-020 direct_sales') {
                        hasSitm020 = true;
                        break;
                    }
                    if (lineItemNameCheck == 'slitm-021 programmatic_sales') {
                        hasSitm021 = true;
                        break;
                    }
                }

                if (hasSitm28 || hasSitm026 || hasSitm020 || hasSitm021 || adBusinessTeam == "1") { // adBusinessTeam == US Sales
                    // Add all line items of the invoice
                    var itemMap = {};
                    var itemCount = invObj.getLineCount({ sublistId: 'item' });

                    // Consolidate items
                    for (var i = 0; i < itemCount; i++) {
                        var lineItemName = invObj.getSublistText({
                            sublistId: 'item',
                            fieldId: 'item',
                            line: i
                        });
                        var lineItemAmount = invObj.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'amount',
                            line: i
                        });
                        var lineItemDescription = invObj.getSublistValue({
                            sublistId: 'item',
                            fieldId: 'description',
                            line: i
                        });

                        if (itemMap[lineItemName]) {
                            itemMap[lineItemName].amount += lineItemAmount;
                        } else {
                            itemMap[lineItemName] = {
                                description: lineItemDescription,
                                amount: lineItemAmount
                            };
                        }
                    }

                    // Generate email content
                    var firstRow = true;
                    for (var itemName in itemMap) {
                        if (itemMap.hasOwnProperty(itemName)) {
                            var item = itemMap[itemName];
                            var description = itemName === 'slitm-026 US_first_party_sales' || itemName === 'slitm-020 direct_sales' || itemName === 'slitm-021 programmatic_sales' ? "Ad Manager Spend" : item.description;
                            emailContent += `
                                <tr>
                                    <td style="${tableStyle}">${invoice.tranid}</td>
                                    <td style="${tableStyle}">${invoice.customerName}</td>
                                    <td style="${tableStyle}">${description}</td>
                                    <td style="${tableStyle}">${itemName}</td>
                                    <td style="${tableStyle}">${invoice.currencyName} ${item.amount}</td>
                                    ${firstRow ? `
                                    <td style="${tableStyle}" rowspan="${Object.keys(itemMap).length}">
                                        <a href="${baseSuiteletUrl}&action=approve&recordId=${invoice.id}">Approve</a>
                                    </td>
                                    <td style="${tableStyle}" rowspan="${Object.keys(itemMap).length}">
                                        <a href="${baseSuiteletUrl}&action=reject&recordId=${invoice.id}">Reject</a>
                                    </td>` : ''}
                                </tr>
                            `;
                            firstRow = false;
                        }
                    }
                }
                else {
                    // Continue with the current logic
                    var itemName = invObj.getSublistText({
                        sublistId: 'item',
                        fieldId: 'item',
                        line: 0
                    });
                    emailContent += `
                        <tr>
                            <td style="${tableStyle}">${invoice.tranid}</td>
                            <td style="${tableStyle}">${invoice.customerName}</td>
                            <td style="${tableStyle}">${invoice.memo}</td>
                            <td style="${tableStyle}">${itemName}</td>
                            <td style="${tableStyle}">${invoice.currencyName} ${invoice.total}</td>
                            <td style="${tableStyle}">
                                <a href="${baseSuiteletUrl}&action=approve&recordId=${invoice.id}">Approve</a>
                            </td>
                            <td style="${tableStyle}">
                                <a href="${baseSuiteletUrl}&action=reject&recordId=${invoice.id}">Reject</a>
                            </td>
                        </tr>
                    `;
                }
            } catch (e) {
                log.error('Error loading invoice', e);
            }
        });

        // Close table and add footer
        emailContent += `
                </tbody>
            </table>
        
            <p>Please review and take action on these invoices at your earliest convenience.</p>
            <p>Thank you</p>
        `;

        return emailContent;
    }

    function convertPostingPeriod(postingPeriod) {
        // Extract the year and month from the Japanese format
        var year = postingPeriod.substring(0, 4);
        var month = postingPeriod.substring(5, 6);

        // Convert the month from Japanese to English
        var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        var monthInEnglish = months[parseInt(month) - 1];

        // Return the formatted posting period in English
        return monthInEnglish + " " + year;
    }



    return { execute: execute };
});
