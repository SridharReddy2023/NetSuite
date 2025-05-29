/**
* @NApiVersion 2.x
* @NScriptType MapReduceScript
*/
define(['N/runtime', 'N/search', 'N/render', 'N/email', 'N/file', 'N/format', 'N/record', 'N/config'],
    function (runtime, search, render, email, file, format, record, config) {
        var scriptObj = runtime.getCurrentScript();

        function getInputData() {
            var user = runtime.getCurrentUser();
            var invoiceInternalID = scriptObj.getParameter({
                name: 'custscript_invoice_record_link'
            });
            invoiceInternalID = JSON.parse(invoiceInternalID);
            log.debug('invoiceInternalID', invoiceInternalID);
            return invoiceInternalID;
        }

        function map(context) {
            var JSONObj = context.value;
            var recID = JSON.parse(JSONObj);
            try {
                var emailStatus = '';
                var blankEmailArr = [];
                var blankEmailIdArr = [];
                var errorContent = '';
                var folderId = 805;
                var currentUser = runtime.getCurrentUser();
                log.debug('Current User Name:', currentUser.id);
                var loggedInUser = currentUser.id;
                var errorEmailCC = [];
                var errEmailRecipientCC = ["sridhar.syagamreddy@smartnews.com", "seth.babu@smartnews.com"];
                //var errEmailRecipientCC = ["sridhar.syagamreddy@smartnews.com"];
                errorEmailCC.push(errEmailRecipientCC);
                var senderId = 939773; //  450560
                var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                var recipientsEmail = '';
                var cc_recipientsEmail = '';
                var emailCC = ''; //["accounting_us@smartnews.com","sridhar.syagamreddy@smartnews.com","bernie.davis@smartnews.com"];
                //var emailCC = ["sridhar.syagamreddy@smartnews.com"];
                var recObj = record.load({
                    type: 'invoice',
                    id: recID
                }); //Load Bill
                var customerId = recObj.getValue({
                    fieldId: "entity"
                });
                log.debug('customerId:', customerId);
                var tranNum = recObj.getValue({
                    fieldId: "transactionnumber"
                });
                log.debug('tranNum:', tranNum);
                
                var customerRecord = record.load({
                    type: 'customer',
                    id: customerId
                });
				// Start: Added part of JIRA request Exclude Customer Number/ID in email subject BSS-780
				var customerName = customerRecord.getValue({
                    fieldId: "companyname"
                });
                log.debug('customerName:', customerName);
				// End: Added part of JIRA request Exclude Customer Number/ID in email subject BSS-780
				
                var notificationEmails = customerRecord.getValue({
                    fieldId: "custentity_email_invoice_notification"
                });
                var cc_notificationEmails = customerRecord.getValue({
                    fieldId: "custentity_cc_email_invoice_notification"
                });
                var printTemplate = recObj.getText({
                    fieldId: "custbody_template_selection"
                });
                log.debug('notificationEmails:', notificationEmails);
                if (notificationEmails) {
                    var findIndex = notificationEmails.indexOf(';');
                    log.debug('findIndex', findIndex);
                    if (findIndex == -1) {
                        var recipientsEmail = [];
                        recipientsEmail.push(notificationEmails);
                        log.debug('recipientsEmail 1', recipientsEmail);
                    } else {
                        recipientsEmail = notificationEmails.split(';');
                        log.debug('recipientsEmail 2', recipientsEmail);
                    }
                    if (cc_notificationEmails) {
                        var cc_findIndex = cc_notificationEmails.indexOf(';');
                        log.debug('cc_findIndex', cc_findIndex);
                        if (cc_findIndex == -1) {
                            var emailCC = [];
                            emailCC.push(cc_notificationEmails);
                            log.debug('emailCC 1', emailCC);
                        } else {
                            emailCC = cc_notificationEmails.split(';');
                            log.debug('emailCC 2', emailCC);
                        }
                    }
                    log.debug("emailCC", emailCC);
                    var dueDate = recObj.getValue({
                        fieldId: "trandate"
                    });
                    log.debug('dueDate:', dueDate);
                    if (dueDate) {
                        var getDate = dueDate.getDate();
                        var getMonth = dueDate.getMonth();
                        getMonth = months[getMonth];
                        var getYear = dueDate.getFullYear();
                        var dateToSetInMail = getMonth + ' ' + getDate + ', ' + getYear;
                        log.debug('dateToSetInMail:', dateToSetInMail);

                        //Get Previous Month Date from the Will Be Paid By date to get the Quarter and Year of the Bill Payments
                        var date = new Date(dueDate);
                        var lastMonthDate = new Date(date.getFullYear(), date.getMonth(), 1);
                        log.debug('lastMonthDate(as per the dueDate):', lastMonthDate);
                        var quarterMonth = lastMonthDate.getMonth();
                        log.debug('quarterMonth:', quarterMonth);
                        var displayMonth = '';
                        if (quarterMonth == 0) {
                            displayMonth = 'January';
                        } else if (quarterMonth == 1) {
                            displayMonth = 'February';
                        } else if (quarterMonth == 2) {
                            displayMonth = 'March';
                        } else if (quarterMonth == 3) {
                            displayMonth = 'April';
                        } else if (quarterMonth == 4) {
                            displayMonth = 'May';
                        } else if (quarterMonth == 5) {
                            displayMonth = 'June';
                        } else if (quarterMonth == 6) {
                            displayMonth = 'July';
                        } else if (quarterMonth == 7) {
                            displayMonth = 'August';
                        } else if (quarterMonth == 8) {
                            displayMonth = 'September';
                        } else if (quarterMonth == 9) {
                            displayMonth = 'October';
                        } else if (quarterMonth == 10) {
                            displayMonth = 'November';
                        } else if (quarterMonth == 11) {
                            displayMonth = 'December';
                        }
                        log.debug('displayMonth:', displayMonth);
                        var displayYear = lastMonthDate.getFullYear();
                        log.debug('displayYear:', displayYear);
						
						
						// Start: Attachment File name be the NetSuite Invoice number BSS-780
						var tranId = recObj.getValue({
							fieldId: "tranid"
						});
						log.debug('tranId:', tranId);
                        var invoicePDF = render.transaction({
                            entityId: Number(recID),
                            printMode: render.PrintMode.PDF,
                        });
						
						invoicePDF.name = tranId + ".pdf";
						// END: Attachment File name be the NetSuite Invoice number BSS-780

                        var emailSubject = customerName + ' SmartNews - ' + displayMonth + ' ' + displayYear + ' Billing Invoice'; 
                        var emailBody = 'Hi,' + '<br>' + '<br>' +
                            'Good Day!' + '<br>' + '<br>' +
                            'Please find attached the Invoice for the <b>' + displayMonth + '</b> <b>' + displayYear + ' campaign</b>. Kindly confirm receipt by emailing <a href="us-ad-billing@smartnews.com" style="color: blue">us-ad-billing@smartnews.com</a>.' +
                            '<br>' + '<br>' +
                            'This is an <b>automated email--</b>. Please do not reply to this unmonitored inbox.' +
                            '<br>' + '<br>' + 'For any questions or concerns, feel free to reach out to us at <a href="us-ad-billing@smartnews.com" style="color: blue">us-ad-billing@smartnews.com</a>.' +
                            '<br>' + '<br>' + 'Please note that we only accept payments via <b>ACH and Wire transfer</b>. Payment details can be found on the invoice.' +
                            '<br>' + '<br>' + 'Thank you!' +
                            '<br>' + '<b>Accounting Team</b>' +
                            '<br>' + printTemplate;

                        //Send Email Action
                        var invoiceEmailArr = [];
                        var cc_invoiceEmailArr = [];
                        var iteration = 7;
                        for (var i = 0; i < recipientsEmail.length; i = i + iteration) {
                            var arrayOfEmails = [];
                            if (i + iteration > recipientsEmail.length) {
                                for (var j = i; j < recipientsEmail.length; j++)
                                    arrayOfEmails.push(recipientsEmail[j]);
                            } else {
                                for (var j = 0; j < iteration; j++) //iteration
                                    arrayOfEmails.push(recipientsEmail[i + j]);
                            }
                            invoiceEmailArr.push(arrayOfEmails);
                        }

                        var loggedInUser = scriptObj.getParameter({
                            name: 'custscript_inv_employee'
                        });
                        var _verify_email = scriptObj.getParameter({
                            name: 'custscript_inv_verify_email_trigger'
                        });
                        /** Verify Email if _verify_email is true */
                        if (_verify_email == 'true') {
                            emailSubject = customerName + 'SmartNews - ' + displayMonth + '' + displayYear + ' Billing Invoice'
                            for (var sendMail = 0; sendMail < invoiceEmailArr.length; sendMail++) {
                                var recipientId = invoiceEmailArr[sendMail];
                                log.debug('recipientId:', recipientId);

                                while (recipientId.length > 0) {
                                    var recEmail = recipientId.splice(0, 9);
                                    log.debug('recEmail: inside', JSON.stringify(recEmail));
                                    var emailSentStatus = email.send({
                                        author:986904,   // Created new employee record with "us-ad-billing@smartnews.com"
                                        recipients: loggedInUser,
                                        // cc: emailCC,
                                        subject: emailSubject,
                                        body: emailBody,
                                        attachments: [invoicePDF],
                                        relatedRecords: {
                                            transactionId: recID
                                        }
                                    });
                                    log.audit('Email Sent Status # ', sendMail);
                                }

                                log.audit('Verify Email Sent Status # ', sendMail);
                            }

                        } else {
                            for (var sendMail = 0; sendMail < invoiceEmailArr.length; sendMail++) {
                                var recipientId = invoiceEmailArr[sendMail];
                                log.debug('recipientId:', recipientId);

                                while (recipientId.length > 0) {
                                    var recEmail = recipientId.splice(0, 9);
                                    log.debug('recEmail: inside', JSON.stringify(recEmail));
                                    var emailSentStatus = email.send({
                                        author: 986904,  // Created new employee record with "us-ad-billing@smartnews.com"
                                        recipients: recEmail,
                                        cc: emailCC,
                                        subject: emailSubject,
                                        body: emailBody,
                                        attachments: [invoicePDF],
                                        relatedRecords: {
                                            transactionId: recID
                                        }
                                    });
                                    log.audit('Email Sent Status # ', sendMail);
                                }
                                log.audit('Email Sent Status # ', sendMail);
                            }
                            var sentDate = new Date();
                            recObj.setValue('custbody_last_email_sent_on', sentDate); //***NEED TO UNCOMMENT AFTER TESTING***
                            var saveRec = recObj.save(true);
                            log.debug('Invoice Updated ', saveRec);
                            emailStatus = 'Email Sent Successfully.';
                        }
                    } else {
                        log.audit('1 - No Will Be Paid By Date for Customer # ', customerName + '; Invoice: ' + tranNum);
                        blankEmailIdArr.push(customerId);
                        log.debug('blankEmailIdArr', blankEmailIdArr);
                        log.debug('blankEmailIdArr.indexOf(customerId)', blankEmailIdArr.indexOf(customerId));
                        if (blankEmailIdArr.indexOf(customerId) != -1) {
                            log.debug('Inside blankEmailIdArr Loop');
                            errorContent = errorContent + '"' + customerName + '"' + ',' + '"' + tranNum + '"' + ',' + 'Due Date is Blank in Invoice' + '\r\n';
                            context.write("errorContent", errorContent);
                        }
                        log.error('Due Date is Blank in Invoice')
                    }
                } else {
                    log.audit('2 - No Email Id for Customer # ', customerName + '; Invoice: ' + tranNum);
                    blankEmailIdArr.push(customerId);
                    log.debug('blankEmailIdArr', blankEmailIdArr);
                    log.debug('blankEmailIdArr.indexOf(customerId)', blankEmailIdArr.indexOf(customerId));
                    if (blankEmailIdArr.indexOf(customerId) != -1) {
                        log.debug('Inside blankEmailIdArr Loop');
                        errorContent = errorContent + '"' + customerName + '"' + ',' + '"' + tranNum + '"' + ',' + 'EMAIL ADDRESS FOR INVOICE NOTIFICATION is Blank in Customer Record' + '\r\n';
                        context.write("errorContent", errorContent);
                    }
                }
            } catch (error) {
                log.audit('3 - Generic Error for Customer # ', customerName + '; Invoice: ' + tranNum);
                blankEmailIdArr.push(customerId);
                log.debug('blankEmailIdArr', blankEmailIdArr);
                log.debug('blankEmailIdArr.indexOf(customerId)', blankEmailIdArr.indexOf(customerId));
                if (blankEmailIdArr.indexOf(customerId) != -1) {
                    log.debug('Inside blankEmailIdArr Loop');
                    errorContent = errorContent + '"' + customerName + '"' + ',' + '"' + tranNum + '"' + ',' + error.message + '\r\n';
                }
                log.error('Error in Invoice Notice Email:', error.message);
                context.write("errorContent", errorContent);
            }
        }

        function reduce(context) {
            try {
                var errorContent = ''
                var errorContentHeader = 'Customer Name,Transaction Number,Error Message';
                var reduceData = context.values;
                log.debug('reduceData data', reduceData);
                var scriptObj = runtime.getCurrentScript();
                var user = runtime.getCurrentUser();
                var loggedInUser = scriptObj.getParameter({
                    name: 'custscript_inv_employee'
                });
                if (!loggedInUser) {
                    loggedInUser = user;
                }
                for (var m = 0; m < reduceData.length; m++) {
                    log.debug('reduceData data', reduceData[m]);
                    errorContent = errorContent + reduceData[m];
                }
                log.debug('errorContent data', errorContent);
                if (errorContent) {
                    var outputData = errorContentHeader + '\r\n' + errorContent;
                    log.debug('outputData', outputData);
                    // Save The File
                    var d = new Date();
                    var month = d.getMonth() + 1;
                    var date = d.getDate();
                    if (date < 9)
                        date = '0'.concat(date);
                    if (month < 9)
                        month = '0'.concat(month);
                    var seconds = d.getSeconds();
                    if (seconds < 9)
                        seconds = '0'.concat(seconds);
                    var minutes = d.getMinutes();
                    if (minutes < 9)
                        minutes = '0'.concat(minutes);
                    var hour = d.getHours();
                    if (hour < 9)
                        hour = '0'.concat(hour);
                    var year = d.getFullYear();
                    var folderId = 805;
                    var senderId = 611884;
                    var fileName = 'Blank Email Id List' + '_' + month + date + year + '_' + hour + minutes + seconds;
                    var fileObj = file.create({
                        name: fileName + '.csv',
                        fileType: file.Type.CSV,
                        contents: outputData,
                        description: 'This contains details of Blank Email Id List',
                        folder: folderId
                    });
                    var fileDownloaded = fileObj.save();
                    log.debug('fileDownloaded:', fileDownloaded);
                    var fileObj = file.load({
                        id: fileDownloaded
                    });
                    var errorEmailBody = 'Hi,' + '<br>' + '<br>' +
                        'Please find attached the Customer list with Error Message in the attached file. Once Error has been fixed then resend the Invoice Notice of Email.' +
                        '<br>' + '<br>' +
                        '<br>' + 'Thanks,' +
                        '<br>' + 'Admin';
                    email.send({
                        author: 611884,
                        recipients: loggedInUser,
                        cc: ['sridhar.syagamreddy@smartnews.com'],
                        subject: 'Notice of Invoice Email has been failed to deliver',
                        body: errorEmailBody,
                        attachments: [fileObj],
                    });
                    log.audit('**Error Email Sent**');
                }
            } catch (ex) {
                log.debug("Reduce: while create reduceData", JSON.stringify(ex));
            }
        }
        return {
            getInputData: getInputData,
            map: map,
            reduce: reduce
        };

    });