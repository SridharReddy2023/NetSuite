/**
 * @NApiVersion 2.x
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
var dd;
define(['N/record', "N/search", 'N/file', 'N/format', './papaparse.min.js', 'N/runtime', 'N/email', 'N/ui/serverWidget'],
    function(record, search, file, format, Papa, runtime, email, serverWidget) {
        //START: Search to get the File from the NetSuite File Cabinet to process the Publisher Bills
        function getInputData() {
            try {
                var myEnvType = JSON.stringify(runtime.envType);
                var pendingFileFolder = 733;
                var vbFileId;
                var vbFileArr = [];
                var vbProcessingFolder = search.create({
                    type: "folder",
                    filters: [
                        ["internalid", "anyof", pendingFileFolder]
                    ],
                    columns: [
                        search.createColumn({
                            name: "numfiles",
                            label: "# of Files"
                        }),
                        search.createColumn({
                            name: "internalid",
                            join: "file",
                            sort: search.Sort.ASC,
                            label: "Internal ID"
                        })
                    ]
                });
                var vbProcessingFolderFileCount = vbProcessingFolder.runPaged().count;
                //log.debug("vbProcessingFolderFileCount",vbProcessingFolderFileCount);
                vbProcessingFolder.run().each(function(result) {
                    vbFileId = result.getValue({
                        name: "internalid",
                        join: "file"
                    });
                    if (vbFileId) {
                        vbFileArr.push({
                            'vbFileId': vbFileId
                        });
                    }
                    return false;
                });
                return vbFileArr;
            } catch (e) {
                log.error('Error in getInputData', e);
            }
        } //END: Search to get the File from the NetSuite File Cabinet to process the Publisher Bills
        //START: Sending the Data to next stage(Reduce) by creating a Key Value pair based on the Publisher Name and File ID
        function map(context) {
            try {
                var fileObj = JSON.parse(context.value);
                //log.debug("fileObj",fileObj);
                var fileId = fileObj.vbFileId;
                //log.debug("fileId",fileId);
                if (fileId) {
                    var strContent = file.load({
                        id: fileId
                    }).getContents();
                    var data = Papa.parse(strContent);
                    var dataContent = data.data;
                    var vbDate, publisherName, siteName, siteURL, smartView = '',
                        vb_month, nsMonth, nsquarter, billDueDate;
                    var parentId, parentName, siteId, siteLevel, descriptioN, rollupLevel = '';
                    for (var dC = 1; dC < dataContent.length; dC++) {
                        vbDate = dataContent[dC][9];
                        publisherName = dataContent[dC][2];
                        siteName = dataContent[dC][6];
                        siteURL = dataContent[dC][4] || dataContent[dC][6];
                        smartView = dataContent[dC][8];
                        parentId = dataContent[dC][0];
                        parentName = dataContent[dC][1];
                        siteId = dataContent[dC][3];
                        siteLevel = dataContent[dC][5];
                        descriptioN = dataContent[dC][7];
                        rollupLevel = dataContent[dC][10];
                        vb_month = dataContent[dC][11];
                        nsMonth = dataContent[dC][12];
                        nsquarter = dataContent[dC][13];
                        billDueDate = dataContent[dC][14] || dataContent[dC][15];
                        //log.debug('FileContent:','fileId: '+fileId+' = vbDate: '+vbDate+'; publisherName: '+publisherName+'; siteName: '+siteName+'; siteURL: '+siteURL+'; smartView: '+smartView+'; billDueDate: '+billDueDate)
                        if (publisherName && siteURL && smartView && vbDate && billDueDate) {
                            context.write({
                                key: publisherName + '_' + fileId,
                                value: {
                                    'vbDate': vbDate,
                                    'publisherName': publisherName,
                                    'siteName': siteName,
                                    'siteURL': siteURL,
                                    'smartView': smartView,
                                    'parentId': parentId,
                                    'parentName': parentName,
                                    'siteId': siteId,
                                    'siteLevel': siteLevel,
                                    'descriptioN': descriptioN,
                                    'rollupLevel': rollupLevel,
                                    'billDueDate': billDueDate
                                }
                            });
                        }
                    }
                }
            } catch (e) {
                log.error('Error in map', e);
            }
        } //END: Sending the Data to next stage(Reduce) by creating a Key Value pair based on the Publisher Name and File ID

        function reduce(context) {
            try {
                var myEnvType = JSON.stringify(runtime.envType);
                var pubBillID = 149;
                var errorFound = 0; //Flag to create a Error File
                var errorMessage = '';
                var errorData = '';
                var reduceKey = context.key;
                reduceKey = reduceKey.split('_');
                var publisherName = reduceKey[0];
                var fileId = reduceKey[1];
                var fileObj = file.load({
                    id: fileId
                });
                var fileName = fileObj.name;
                var contentArr = context.values;
                var rVbDate, rPublisherName, rSiteName, rSiteURL, rSmartView, rVbBillDueDate, rvSiteId;
                var vbQty = 0;
                for (var cA = 0; cA < contentArr.length; cA++) {
                    var rContentArr = JSON.parse(contentArr[cA]);
                    rSiteName = rContentArr.siteName;
                    rSiteURL = rContentArr.siteURL;
                    rVbDate = rContentArr.vbDate;
                    rVbBillDueDate = rContentArr.billDueDate;
                    rSmartView = rContentArr.smartView;
					rvSiteId = rContentArr.siteId;
                    vbQty = vbQty + Number(rSmartView);
                }
                //log.debug('Reduce Final Date to process', 'publisherName: ' + publisherName + '; rVbDate: ' + rVbDate + '; vbQty: ' + vbQty);
                if (publisherName && vbQty && rVbDate && rVbBillDueDate) {
                    try {
                        var validDate = checkFileDate(rVbDate); //Validate the Date in the File
                        //if (validDate == true) 
                        {
                            var itemId = itemSearch(publisherName); //Get Item Internal ID by using a Publisher(Vendor) Name
                            log.debug("itemId", itemId);
                            if (itemId) {
                                var vendorId = vendorSearch(itemId); //Get Vendor Internal ID by using a Name
                                //log.debug("vendorId",vendorId);
                                if (vendorId) {
                                    var monthlyFee = getMonthlyFee(itemId, vbQty); //Get Monthly Fee from Payment Tier search
                                    //log.debug('monthlyFee/Rate', monthlyFee);
                                    var recCreate = createVendorBill(vendorId, itemId, monthlyFee, contentArr, vbQty, rVbDate, pubBillID, rVbBillDueDate, rvSiteId); //Creating a Vendor Bill
                                } else {
                                    errorFound = 1;
                                    errorMessage = 'Vendor/Publisher Record Not exist in system';
                                    log.error('02-errorMessage:', errorMessage);
                                }
                            } else {
                                errorFound = 1;
                                errorMessage = 'Item/Product not exist in Account for Publisher: ' + publisherName;
                                log.error('03-errorMessage:', errorMessage);
                            }
                        }
                        // else {
                        // errorFound = 1;
                        // errorMessage = 'The File contains old data, please check the Date in the file for publisher: ' + publisherName;
                        // log.error('00-errorMessage:', errorMessage);
                        // }
                    } catch (err) {
                        errorFound = 1
                        errorMessage = err.message;
                        log.error('01-Error in Create VB for Publisher File:', errorMessage);
                    }
                    //IF there is any error, capturing all the errors and passing the error details to final stage(Summarize) to send an email and also to create a error file.
                    if (errorMessage && errorFound == 1) {
                        for (var eA = 0; eA < contentArr.length; eA++) {
                            var errContentArr = JSON.parse(contentArr[eA]);
                            errSiteName = errContentArr.siteName || '';
                            errSiteURL = errContentArr.siteURL || '';
                            errVbDate = errContentArr.vbDate || '';
                            errSmartView = errContentArr.smartView || '';
                            errparentId = errContentArr.parentId || '';
                            errparentName = errContentArr.parentName || '';
                            errsiteId = errContentArr.siteId || '';
                            errsiteLevel = errContentArr.siteLevel || '';
                            errdescriptioN = errContentArr.descriptioN || '';
                            errrollupLevel = errContentArr.rollupLevel || '';
                            errDueDate = errContentArr.billDueDate || '';

                            if (eA == 0) {
                                errorData = '"' + errparentId + '"' + ',' + '"' + errparentName + '"' + ',' + '"' + publisherName + '"' + ',' + '"' + errsiteId + '"' + ',' + '"' + errSiteURL + '"' + ',' + '"' + errsiteLevel + '"' + ',' + '"' + errSiteName + '"' + ',' + '"' + errdescriptioN + '"' + ',' + '"' + errSmartView + '"' + ',' + '"' + errVbDate + '"' + ',' + '"' + errrollupLevel + '"' + ',' + '"' + errDueDate + '"' + ',' + '"' + errorMessage + '"' + ',' + '"' + fileName + '"'
                            } else {
                                errorData = errorData + '\r\n' + '"' + errparentId + '"' + ',' + '"' + errparentName + '"' + ',' + '"' + publisherName + '"' + ',' + '"' + errsiteId + '"' + ',' + '"' + errSiteURL + '"' + ',' + '"' + errsiteLevel + '"' + ',' + '"' + errSiteName + '"' + ',' + '"' + errdescriptioN + '"' + ',' + '"' + errSmartView + '"' + ',' + '"' + errVbDate + '"' + ',' + '"' + errrollupLevel + '"' + ',' + '"' + errDueDate + '"' + ',' + '"' + errorMessage + '"' + ',' + '"' + fileName + '"'
                            }
                        }
                        log.error('**Reduce Final errorData:', errorData);
                    }
                    context.write({
                        key: fileId,
                        value: {
                            'errorData': errorData,
                            'errFileId': fileId,
                            'errorFound': errorFound
                        }
                    });
                }
            } catch (e) {
                log.error('Error in reduce', e);
            }

            // START: Get Monthly Fee from Payment Tier search
            function getMonthlyFee(publisherName, vbQty) {
                try {
                    var monthlyFee = 0;
                    var monthlyFee1 = 0;
                    var monthlyFeeRange = 0;
                    var pageView, findIndex;
                    var view, view1, view2 = 0;
                    var pricingTypeSearch = search.create({
                        type: "customrecord_sn_pricing_tier_list",
                        filters: [
                            ["custrecord_pubr_item_name_num", "anyof", publisherName], "AND",
                            ["isinactive", "is", "F"]
                        ],
                        columns: [search.createColumn({
                            name: "custrecord_pricing_type"
                        })]
                    });
                    var pricingTypeSearchC = pricingTypeSearch.runPaged().count;
                    var priceType;
                    pricingTypeSearch.run().each(function(result) {
                        priceType = result.getValue({
                            name: "custrecord_pricing_type"
                        })
                        return false;
                    });
                    if (priceType == 1 || pricingTypeSearchC > 1) { //1 = Page Views
                        var customrecord_sn_pricing_tier_listSearchObj = search.create({
                            type: "customrecord_sn_pricing_tier_list",
                            filters: [
                                ["custrecord_pubr_item_name_num", "anyof", publisherName],
                                "AND",
                                ["isinactive", "is", "F"]
                            ],
                            columns: [
                                search.createColumn({
                                    name: "custrecord_sn_monthly_page_view",
                                    label: "Monthly Pageviews"
                                }),
                                search.createColumn({
                                    name: "custrecord_sn_monthly_view",
                                    label: "Monthly Fee"
                                }),
                                search.createColumn({
                                    name: "custrecord_cpm_rate",
                                    label: "CPM Rate"
                                }),
                                search.createColumn({
                                    name: "custrecord_flat_rate",
                                    label: "Flat Rate"
                                }),
                                search.createColumn({
                                    name: "custrecord_pricing_type",
                                    label: "Pricing Type"
                                })
                            ]
                        });
                        var Srch_Results = customrecord_sn_pricing_tier_listSearchObj.run().getRange({
                            start: 0,
                            end: 999
                        });
                        for (var fC = 0; fC < Srch_Results.length; fC++) {
                            pageView = Srch_Results[fC].getValue('custrecord_sn_monthly_page_view');
                            findIndex = pageView.indexOf('+');
                            if (findIndex == -1) {
                                pageView = pageView.split('-');
                                log.debug("pageView -- Inside", pageView);
                                view1 = pageView[0].trim(); // 0
                                view1 = view1.replace(/,/g, '');
                                view2 = pageView[1].trim(); // 5000000
                                view2 = view2.replace(/,/g, '');
                                if (view1 <= vbQty && vbQty <= view2) // (0<=600 && 600<=200000)
                                {
                                    if (Srch_Results[fC].getValue('custrecord_sn_monthly_view') > 0.00) {
                                        monthlyFee = Srch_Results[fC].getValue('custrecord_sn_monthly_view');
                                        log.debug("monthlyFee11", monthlyFee);
                                    }
                                    if (Srch_Results[fC].getValue('custrecord_flat_rate') > 0.00) {
                                        monthlyFee = Srch_Results[fC].getValue('custrecord_flat_rate');
                                        log.debug("monthlyFee12", monthlyFee);
                                    }
                                    break;
                                }
                            } else {
                                var chkPriceType = Srch_Results[fC].getValue('custrecord_pricing_type');
                                //START: Pricing Type is Flat Rate + CPM (4)
                                if (chkPriceType == 4) {
                                    pageView = pageView.split('+');
                                    view = pageView[0].trim();
                                    view = view.replace(/,/g, '');
                                    var tempFee = '';
                                    if (vbQty >= view) {
                                        var feeDiff = (Number(vbQty) - Number(view));
                                        if (feeDiff == 0) {
                                            tempFee = Srch_Results[fC].getValue('custrecord_flat_rate');
                                            if (tempFee) {
                                                monthlyFee = tempFee;
                                            }
                                            break;
                                        } else { // If the Monthly Page Views is Greater the Bill QTY then minus the views & perform Math
                                            var fCFlatRate = Srch_Results[fC].getValue('custrecord_flat_rate');
                                            var fCCPMRate = Srch_Results[fC].getValue('custrecord_cpm_rate');
                                            if (fCFlatRate && fCCPMRate) {
                                                var remFee = (Number(fCCPMRate) / 1000)
                                                var tempFee2 = (remFee * feeDiff);
                                                var tempFeeF = Number(fCFlatRate) + Number(tempFee2);
                                                monthlyFee = tempFeeF.toFixed(2);
                                            }
                                        }
                                    }
                                } else {
                                    pageView = pageView.split('+');
                                    view = pageView[0].trim();
                                    view = view.replace(/,/g, '');
                                    var tempFee;
                                    if (vbQty >= view) {
                                        tempFee = Srch_Results[fC].getValue('custrecord_sn_monthly_view'); //Monthly Fee
                                        if (_logValidation(tempFee) && parseFloat(tempFee) > 0.00) {
                                            monthlyFee = tempFee;
                                        } else {
                                            tempFee = Srch_Results[fC].getValue('custrecord_cpm_rate');
                                            if (tempFee) {
                                                tempFee = (Number(tempFee) / 1000);
                                                tempFee = (tempFee * vbQty);
                                                monthlyFee = tempFee.toFixed(2);
                                            }
                                        }
                                        break;
                                    }
                                } // END - Of Pricing Type Check Loop
                            }
                        }
                    } else if (priceType == 2 && pricingTypeSearchC == 1) { //2 = Flat Rate
                        var flatRateSearch = search.create({
                            type: "customrecord_sn_pricing_tier_list",
                            filters: [
                                ["custrecord_pubr_item_name_num", "anyof", publisherName],
                                "AND",
                                ["isinactive", "is", "F"]
                            ],
                            columns: [
                                search.createColumn({
                                    name: "custrecord_flat_rate"
                                })
                            ]
                        });
                        var flatRateSearchC = flatRateSearch.runPaged().count;
                        flatRateSearch.run().each(function(result) {
                            monthlyFee = result.getValue({
                                name: "custrecord_flat_rate"
                            })
                            return false;
                        });
                    } else if (priceType == 3 && pricingTypeSearchC == 1) { //3 = CPM
                        var cpmRateSearch = search.create({
                            type: "customrecord_sn_pricing_tier_list",
                            filters: [
                                ["custrecord_pubr_item_name_num", "anyof", publisherName],
                                "AND",
                                ["isinactive", "is", "F"]
                            ],
                            columns: [
                                search.createColumn({
                                    name: "custrecord_cpm_rate"
                                }),
                                search.createColumn({
                                    name: "custrecord_sn_monthly_page_view"
                                })
                            ]
                        });
                        var cpmRateSearchC = cpmRateSearch.runPaged().count;
                        cpmRateSearch.run().each(function(result) {
                            monthlyFee1 = result.getValue({
                                name: "custrecord_cpm_rate"
                            });
                            monthlyFeeRange = result.getValue({
                                name: "custrecord_sn_monthly_page_view"
                            });
                            if (monthlyFeeRange) {
                                monthlyFeeRange = monthlyFeeRange.split('+');
                                monthlyFeeRange = monthlyFeeRange[0].trim();
                                monthlyFeeRange = monthlyFeeRange.replace(/,/g, '');
                            }
                            if (vbQty >= monthlyFeeRange) {
                                monthlyFee = (Number(monthlyFee1) / 1000) // 0.0015
                                monthlyFee = (monthlyFee * vbQty); // 112.848
                                monthlyFee = monthlyFee.toFixed(2);
                            }
                            return false;
                        });
                    }
                    return monthlyFee;
                } catch (e) {
                    log.error('Error in Getting Monthly fee:', e);
                }
            } // END: Get Monthly Fee from Payment Tier search

            // START: Get Vendor Internal ID by using a Name
            function vendorSearch(publisherName) {
                var vendorId;
                var vendorSearchObj = search.create({
                    type: "vendor",
                    filters: [
                        ["custentity_publisher_item_name_number_n", "anyof", publisherName],
                        "AND",
                        ["isinactive", "is", "F"]
                    ],
                    columns: [
                        search.createColumn({
                            name: "internalid",
                            label: "Internal ID"
                        })
                    ]
                });
                var searchResultCount = vendorSearchObj.runPaged().count;
                vendorSearchObj.run().each(function(result) {
                    vendorId = result.getValue('internalid');
                    return false;
                });
                return vendorId;
            } // END: Get Vendor Internal ID by using a Name

            // START: Get Item Internal ID by using a Publisher(Vendor) Name
            function itemSearch(publisherName) {
                var itemId;
                var noninventoryitemSearchObj = search.create({
                    type: "noninventoryitem",
                    filters: [
                        ["type", "anyof", "NonInvtPart"],
                        "AND",
                        ["name", "is", publisherName],
                        "AND",
                        ["isinactive", "is", "F"]
                    ],
                    columns: [
                        search.createColumn({
                            name: "internalid",
                            label: "Internal ID"
                        })
                    ]
                });
                var searchResultCount = noninventoryitemSearchObj.runPaged().count;

                var noninventoryitemSearchObjwithQuotation = search.create({
                    type: "noninventoryitem",
                    filters: [
                        ["type", "anyof", "NonInvtPart"],
                        "AND",
                        ["name", "haskeywords", publisherName],
                        "AND",
                        ["isinactive", "is", "F"]
                    ],
                    columns: [
                        search.createColumn({
                            name: "internalid",
                            label: "Internal ID"
                        })
                    ]
                });
                var searchResultCountwithQuote = noninventoryitemSearchObjwithQuotation.runPaged().count;
                log.debug("searchResultCount", searchResultCount);
                log.debug("searchResultCountwithQuote", searchResultCountwithQuote);
                if (searchResultCount > 0) {
                    noninventoryitemSearchObj.run().each(function(result) {
                        itemId = result.getValue('internalid');
                        return false;
                    });
                } else if (searchResultCountwithQuote > 0) {
                    noninventoryitemSearchObjwithQuotation.run().each(function(result) {
                        itemId = result.getValue('internalid');
                        return false;
                    });
                }
                return itemId;
            } // END: Get Item Internal ID by using a Publisher(Vendor) Name

            // START: Creating a Vendor Bill
            function createVendorBill(vendorId, itemId, monthlyFee, contentArr, totalView, rVbDate, pubBillID, rVbBillDueDate, rvSiteId) { // vbQty = totalView
                var ppFlag = false;
                var arrLen = contentArr.length;
                var vendRec = record.load({
                    type: 'vendor',
                    id: vendorId,
                    isDynamic: true
                });
                log.debug("rVbDate", rVbDate); // 01-08-2024
                var pmDate = new Date(rVbDate.split("-")[0], rVbDate.split("-")[1], rVbDate.split("-")[2] - 1);
                log.debug("pmDate", pmDate);
                log.debug("rVbBillDueDate", rVbBillDueDate); //31-07-2024
                var fDueDate = new Date(rVbBillDueDate.split("-")[2], rVbBillDueDate.split("-")[1] - 1, rVbBillDueDate.split("-")[0]);
                log.debug("fDueDate", fDueDate);

                // Added additional code for Publisher Program for release on 03/31/2024 ---- JIRA BSYS-643 
                // To cater for beyond bonus calculation for eligible Publishers

                //start: Added as the part of Beyond Program implementation			
                var vendorFields = search.lookupFields({
                    type: "vendor",
                    id: vendorId,
                    columns: ['custentity_pprog_calculation', 'custentity_beyond_percentage', 'custentity_beyond_mg', 'custentity_pp_start_date']
                });
                var pubProgStartDate = vendorFields.custentity_pp_start_date;
                //log.debug("pubProgStartDate",pubProgStartDate);
                var pubProgFullDateFormat = '';
                if (pubProgStartDate) 
				{
                    pubProgFullDateFormat = new Date(pubProgStartDate.split("-")[0], pubProgStartDate.split("-")[1] - 1, pubProgStartDate.split("-")[2]);
                    log.debug("pubProgFullDateFormat", pubProgFullDateFormat); //2024-06-01
                }
				var siteIdArray = []
                var getBrandUrlDataObject = getBrandUrlData(vendorId, rVbDate,siteIdArray, itemId);
				log.debug("getBrandUrlDataObject",JSON.stringify(getBrandUrlDataObject))
				log.debug("contentArr",JSON.stringify(contentArr))
                log.debug("rVbDate",rVbDate);// 2024-07-01
                var fileDateComp = new Date(rVbDate.split("-")[0], rVbDate.split("-")[1] - 1, rVbDate.split("-")[2]); //formatFileDate(rVbDate);
                log.debug("fileDateComp",fileDateComp);
                if (pubProgFullDateFormat && fileDateComp) {
                    if (fileDateComp.getTime() >= pubProgFullDateFormat.getTime()) {
                        ppFlag = true;
                    }
                }
                var bonusAmt = 0;
				var bonusAmtBrand = 0;
                var secondCase = [];
                if (_logValidation(vendorFields.custentity_pprog_calculation) && ppFlag == true) 
				{
                    var _pprog_calculation = vendorFields.custentity_pprog_calculation[0].text;
					//log.debug("_pprog_calculation",_pprog_calculation);
                    var _beyond_percentage = vendorFields.custentity_beyond_percentage;
					//log.debug("_beyond_percentage",_beyond_percentage);
                    var mgValue = vendorFields.custentity_beyond_mg || 0;
                    if (_pprog_calculation == "Publisher") 
					{
                        var currentBonus = monthlyFee * _beyond_percentage / 100;
                        currentBonus = currentBonus > 0 ? currentBonus : 0;
                        bonusAmt = Math.max(currentBonus, mgValue);
                    } else if (_pprog_calculation == "Brand" && getBrandUrlDataObject.length > 0) 
					{
                        var currentBonus = monthlyFee * _beyond_percentage / 100;
                        currentBonus = currentBonus > 0 ? currentBonus : 0;
                        for (var vbL = 0; vbL < arrLen; vbL++) 
						{
                            var rContentArray = JSON.parse(contentArr[vbL]);
                            var BrandUrl = false;
							if(BrandUrl == false)
							{
								log.debug("rContentArray",vbL+'/'+JSON.stringify(rContentArray));
								for (url in getBrandUrlDataObject) 
								{
									log.debug("getBrandUrlDataObject[url]",JSON.stringify(getBrandUrlDataObject[url]));
									
									if(getBrandUrlDataObject[url].siteId)
									{
										if(getBrandUrlDataObject[url].siteId == rContentArray.siteId)
										{
											BrandUrl = true;
											break;
										}
									}
									else if (getBrandUrlDataObject[url].siteURL == rContentArray.siteURL) 
									  {
										BrandUrl = true;
										break;
									}
								}
							}
                            var lineAmt = 0;
                            var sitePageViews = 0;
                            if (BrandUrl == true || BrandUrl == "true") 
							{
                                sitePageViews = rContentArray.smartView || 0;
                                lineAmt = currentBonus * sitePageViews / totalView;
								log.debug("lineAmt",lineAmt);
								log.debug("bonusAmt",bonusAmt);
                                bonusAmt = parseFloat(bonusAmt) + parseFloat(lineAmt);
								log.debug("bonusAmt",bonusAmt);	
                            }
                            secondCase.push({
                                _BrandUrl: BrandUrl,
                                _URL: rContentArray.siteURL,
                                _sitePageViews: sitePageViews,
                                _totalView: totalView,
                                _currentBonus: currentBonus,
                                _lineAmt: lineAmt
                            })
                        }
						bonusAmt = Math.max(bonusAmt, mgValue);
					log.debug("bonusAmt--after",bonusAmt);
                    }
					
                    log.debug("bonusAmt ///// secondCase",bonusAmt + " //// "+JSON.stringify(secondCase));
                }

                // Deriving Item for Publisher Program using Saved search
                var beyondItem = '';
                var beyondItemSearchObj = search.create({
                    type: "noninventoryitem",
                    filters: [
                        ["type", "anyof", "NonInvtPart"],
                        "AND",
                        ["custitem_publisher_program", "anyof", "1"]
                    ],
                    columns: [
                        search.createColumn({
                            name: "internalid",
                            label: "Internal ID"
                        }),
                        search.createColumn({
                            name: "itemid",
                            sort: search.Sort.ASC,
                            label: "Name"
                        })
                    ]
                });

                var searchResultCount = beyondItemSearchObj.runPaged().count;
                beyondItemSearchObj.run().each(function(result) {
                    beyondItem = result.getValue('internalid');
                    return true;
                });
				log.debug("beyondItem",beyondItem);
                // Deriving Department for Publisher Program using Saved search
                var beyondDepartment = '';
                var departmentSearchObj = search.create({
                    type: "department",
                    filters: [
                        ["isinactive", "is", "F"],
                        "AND",
                        ["name", "contains", "A00463 Project Beyond"]
                    ],
                    columns: [
                        search.createColumn({
                            name: "internalid",
                            label: "Internal ID"
                        }),
                        search.createColumn({
                            name: "name",
                            sort: search.Sort.ASC,
                            label: "Name"
                        })
                    ]
                });
                var searchResultCount = departmentSearchObj.runPaged().count;
                //log.debug("departmentSearchObj result count",searchResultCount);
                departmentSearchObj.run().each(function(result) {
                    beyondDepartment = result.getValue('internalid');
                    return true;
                });
                //End: Added as the part of Beyond Program implementation

                var vbRec = record.create({
                    type: 'vendorbill',
                    isDynamic: true,
                    defaultValues: {
                        customform: pubBillID,
                    }
                });
                vbRec.setValue('entity', vendorId);
                vbRec.setValue('subsidiary', 4);
                vbRec.setValue('department', 81);
                vbRec.setValue('trandate', pmDate);
                vbRec.setValue('duedate', fDueDate);
                vbRec.setValue('memo', 'SV1st'); //Set Memo as SV1st
                vbRec.setValue('currency', 2); //Set Currency as USD(Internal ID is 2)

                for (var vbL = 0; vbL < arrLen; vbL++) {
                    var rContentArray = JSON.parse(contentArr[vbL]);
                    var lineNum = vbRec.selectNewLine({
                        sublistId: 'item'
                    });
                    vbRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'item',
                        value: itemId,
                        ignoreFieldChange: true
                    });
                    vbRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'quantity',
                        value: 0,
                        ignoreFieldChange: true
                    });
                    vbRec.setCurrentSublistValue({ //Set Tax Code as Tax free
                        sublistId: 'item',
                        fieldId: 'taxcode',
                        value: 7,
                        ignoreFieldChange: true
                    });
					 vbRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_site_id',
                        value: rContentArray.siteId,
                        ignoreFieldChange: true
                    });
                    vbRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_website_name',
                        value: rContentArray.siteName,
                        ignoreFieldChange: true
                    });
                    vbRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_dp_pubwebsiteurl',
                        value: rContentArray.siteURL,
                        ignoreFieldChange: true
                    });
                    vbRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_pages_views',
                        value: rContentArray.smartView,
                        ignoreFieldChange: true
                    });
                    vbRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'rate',
                        value: 0,
                        ignoreFieldChange: true
                    });
                    vbRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'amount',
                        value: 0,
                        ignoreFieldChange: true
                    });
                    vbRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'department',
                        value: 81,
                        ignoreFieldChange: true
                    });
                    vbRec.commitLine({
                        sublistId: 'item'
                    });
                }

                // Added additional code for Publisher Program for release on 03/31/2024 ---- JIRA BSYS-643 
                // To cater for beyond bonus calculation for eligible Publishers

                // Start adding bonus Item to the bill 
                if (bonusAmt > 0 && beyondItem) 
				{
                    bonusAmt = parseFloat(bonusAmt);
                    var mL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                    var d_pmDate = format.parse({
                        value: pmDate,
                        type: format.Type.DATE
                    })
                    var monthName = mL[d_pmDate.getMonth()]
                    var stringName = "Beta Payment for " + monthName + " " + d_pmDate.getFullYear() + "|" + bonusAmt;

                    vbRec.selectNewLine({
                        sublistId: 'item'
                    });
                    vbRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'item',
                        value: beyondItem,
                        ignoreFieldChange: true
                    });
                    vbRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'quantity',
                        value: 1,
                        ignoreFieldChange: true
                    });
                    vbRec.setCurrentSublistValue({ //Set Tax Code as Tax free
                        sublistId: 'item',
                        fieldId: 'taxcode',
                        value: 7,
                        ignoreFieldChange: true
                    });
                    vbRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_website_name',
                        value: "N/A",
                        ignoreFieldChange: true
                    });
                    vbRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_dp_pubwebsiteurl',
                        value: "N/A",
                        ignoreFieldChange: true
                    });
                    vbRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_pages_views',
                        value: 0,
                        ignoreFieldChange: true
                    });
                    vbRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'rate',
                        value: bonusAmt,
                        ignoreFieldChange: true
                    });
                    vbRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'amount',
                        value: bonusAmt,
                        ignoreFieldChange: true
                    });

                    vbRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'department',
                        value: beyondDepartment,
                        ignoreFieldChange: true
                    });
                    vbRec.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'custcol_business_category',
                        value: 4,
                        ignoreFieldChange: true
                    });
                    vbRec.commitLine({
                        sublistId: 'item'
                    });

                    vbRec.setValue("custbody_beyond_details", stringName);
                    // if(case1Scenario == true)
                    // {
                    // monthlyFee = 0;
                    // }
                }
                // end adding bonus Item to the bill 

                //Adding Final Item Line for the rate/amount details

                var lineNum = vbRec.selectNewLine({
                    sublistId: 'item'
                });
                vbRec.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    value: itemId,
                    ignoreFieldChange: true
                });
                vbRec.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity',
                    value: 1,
                    ignoreFieldChange: true
                });
                vbRec.setCurrentSublistValue({ //Set Tax Code as Tax free
                    sublistId: 'item',
                    fieldId: 'taxcode',
                    value: 7,
                    ignoreFieldChange: true
                });
                vbRec.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'rate',
                    value: monthlyFee,
                    ignoreFieldChange: true
                });
                vbRec.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'amount',
                    value: monthlyFee,
                    ignoreFieldChange: true
                });
                vbRec.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'department',
                    value: 81,
                    ignoreFieldChange: true
                });
                vbRec.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_pages_views',
                    value: totalView,
                    ignoreFieldChange: true
                });
                vbRec.commitLine({
                    sublistId: 'item'
                });
                vbRec.setValue('custbody_publisher_vendor_bill', true); // Check the "PUBLISHER VENDOR BILL?" check-box only for the Bills created for Publisher
                var vbSaved = vbRec.save(true);
                log.audit('**** vbSaved # ' + vbSaved);
            } // END: Creating a Vendor Bill
        }

        //Status of the Process will be sent to the Key Stakeholders.
        function summarize(summary) {
            try {
                var myEnvType = JSON.stringify(runtime.envType);
                var errorFolderID = 734;
                var processedFolderID = 732;
                var scriptObj = runtime.getCurrentScript();
                var reduceSummary = summary.reduceSummary;
                var fileIDArr = [];
                var errorFlag = false;
                var reduceErrorData, reduceValue, processedRecord;
                var finalFileObject = [];
                var processedDataCount = 0; // To store all file Id's
                var fileId = ''; // To store all file Id's
                var errFileIdS = ''; //To store Error File Id's
                var errContent = ''; //To store Error Data's
                var errFileHeader = 'parent_id,parent_name,external_id,site_id,site_url,descendant_site_level,name,description,smart_view,month_dt,rollup_level,Error_Message,FileName';
                errContent = errFileHeader + '\r\n';
                summary.output.iterator().each(function(key, value) {
                    fileId = JSON.parse(key);
                    if (fileIDArr.indexOf(fileId) == -1) {
                        fileIDArr.push(fileId);
                    }
                    reduceValue = JSON.parse(value);
                    reduceErrorData = reduceValue.errorData;
                    if (reduceErrorData) {
                        errContent = errContent + reduceErrorData + '\r\n';
                        errFileIdS = reduceValue.errFileId;
                        errorFlag = true;
                    }
                    return true;
                });

                //START: Create Error File
                var errFileDownloaded = '';
                var errFileName;
                if (errContent && errFileIdS && errorFlag) {
                    var OrgFileObj = file.load({
                        id: errFileIdS
                    });
                    var OrignalFileName = OrgFileObj.name;
                    OrignalFileName = OrignalFileName.split('.');
                    OrignalFileName = OrignalFileName[0];
                    OrignalFileName = OrignalFileName + '_ErrorFile.csv';
                    errFileName = OrignalFileName;
                    var errFileObj = file.create({
                        name: errFileName,
                        fileType: file.Type.CSV,
                        contents: errContent,
                        description: 'This file contains details of Monthly Payment for Publisher Error',
                        folder: errorFolderID
                    });
                    errFileDownloaded = errFileObj.save();
                } //END: Create Error File
                if (fileIDArr.length > 0) {
                    //START: Move File to Processed Folder
                    var OrigFileName = '';
                    for (var fA = 0; fA < fileIDArr.length; fA++) {
                        var fileObj = file.load({
                            id: fileIDArr[fA]
                        });
                        finalFileObject.push(fileObj);
                        OrigFileName = fileObj.name;
                        fileObj.folder = processedFolderID;
                        var fileId = fileObj.save();
                    } //END: Move File to Processed Folder

                    //START: Send Email's to Key stake-holder
                    var emailArr = [];
                    var emailCC = [];
                    var senderId = 272752;
                    var recipientsEmail = 'sridhar.syagamreddy@smartnews.com';
                    var recipientCC = 'sridhar.syagamreddy@smartnews.com';
                    emailArr.push(recipientsEmail);
                    emailCC.push(recipientCC);
                    var emailBody = '';
                    var emailSubject = 'Monthly Payment Publisher file Processed status';
                    if (errFileDownloaded) {
                        emailBody = 'Hi,' + '\r\n' + '\r\n' + 'Monthly Payment Publisher File has been Processed.' + '\r\n' + ' Due to some error all records are not processed. To find the error details refer the attachment ' + '\r\n' + ' File Name: "' + OrigFileName + '"' + '\r\n' + 'Error File Name: "' + errFileName + '"' + '\r\n' + '\r\n' + 'Thanks,' + '\r\n' + 'Admin.'; //If Error then this body will be added in Email
                        fileObject = file.load({
                            id: errFileDownloaded
                        });
                        finalFileObject.push(fileObject);
                    } else {
                        emailBody = 'Hi,' + '\r\n' + '\r\n' + 'Monthly Payment Publisher File has been Processed Successfully.' + '\r\n' + 'File Name: "' + OrigFileName + '"' + '\r\n' + '\r\n' + '\r\n' + 'Thanks,' + '\r\n' + 'Admin.'; //If No Error then this body will be added in Email
                    }
                    email.send({
                        author: senderId,
                        recipients: emailArr,
                        cc: emailCC,
                        subject: emailSubject,
                        body: emailBody,
                        attachments: finalFileObject
                    });
                }
            } catch (e) {
                log.error('Error in summarize', e);
            }
        }

        //START: Check the Date in File is from Previous month of the execution date or not
        function checkFileDate(rVbDate) {
            try {
                var validDate;
                var fileDate;
                var dateValidate = rVbDate.indexOf('-');
                var yY, mM, dD;
                if (dateValidate != -1) {
                    var nDate = rVbDate.split('-');
                    mM = nDate[1];
                } else {
                    var dateValidate = rVbDate.indexOf('/');
                    if (dateValidate != -1) {
                        var nDate = rVbDate.split('/');
                        mM = nDate[0];
                    }
                } //END: Get Date From File
                if (mM) {
                    var currentMonth = new Date().getMonth();
                    if (currentMonth == 0) {
                        if (mM == 12) {
                            validDate = true
                        } else {
                            validDate = false;
                        }
                    } else {
                        if (currentMonth == mM) {
                            validDate = true
                        } else {
                            validDate = false;
                        }
                    }
                }
                return validDate;
            } catch (e) {
                log.error('Error in checkFileDate function:', e);
            }
        } //END: Check the Date in File is from Previous month of the execution date or not

        function formatFileDate(rVbDate) //2024-04-01
        {
            try {
                var validDate;
                log.debug("rVbDate", rVbDate);
                var dateValidate = rVbDate.indexOf('-'); // 01-04-2024
                if (dateValidate != -1) {
                    var formatDate = rVbDate.split('-');
                    log.debug("formatDate", formatDate);
                    validDate = new Date(formatDate[2], formatDate[1] - 1, formatDate[0]);
                    log.debug("validDate", validDate); // 1906-10-15
                } else {
                    var dateValidate = rVbDate.indexOf('/');
                    if (dateValidate != -1) {
                        var formatDate = rVbDate.split('/');
                        validDate = new Date(formatDate[2], formatDate[0] - 1, formatDate[1]);
                    }
                }
                return validDate;
            } catch (e) {
                log.error('Error in checkFileDate function:', e);
            }
        }

        //Start of the code deriving URLs where Beyond Flag is Checked.
        function getBrandUrlData(vendor, rVbDate,siteIdArray,itemId) {
            var BrandUrlConsider = [];
            var fileDateCompWithURL = '';
            var ppURLFlag = false;
            var customrecord_publishers_url_linkSearchObj = search.create({
                type: "customrecord_publishers_url_link",
                filters: [
                    ["isinactive", "is", "F"],
                    "AND",
                    ["custrecord_publisher_name_vendor", "anyof", vendor],
                    "AND",
					["custrecord_publisher_item_name_number", "anyof", itemId],
                    "AND",
                    ["custrecord_beyond", "is", "T"],
                ],
                columns: [
                    search.createColumn({
                        name: "custrecord_publisher_url",
                        label: "Publisher URL / Descriptions"
                    }),
                    search.createColumn({
                        name: "custrecord_beyond",
                        label: "Beyond"
                    }),
                    search.createColumn({
                        name: "custrecord_beyond_start_date",
                        label: "PP Start Date"
                    }),'custrecord_site_id'

                ]
            });
            var searchResultCount = customrecord_publishers_url_linkSearchObj.runPaged().count;
            customrecord_publishers_url_linkSearchObj.run().each(function(result) {
                var Beyond = result.getValue("custrecord_beyond");
                var PublisherURL = result.getValue("custrecord_publisher_url");
				var siteID = result.getValue("custrecord_site_id");
                var pubBrandURLStartDate = result.getValue("custrecord_beyond_start_date");
                var pubProgBrandURLFullDate = '';
                if (pubBrandURLStartDate) 
				{
                    pubProgBrandURLFullDate = new Date(pubBrandURLStartDate.split("-")[0], pubBrandURLStartDate.split("-")[1] - 1, pubBrandURLStartDate.split("-")[2]);
                    log.debug("pubProgBrandURLFullDate ---After", pubProgBrandURLFullDate);
                }
                log.debug("rVbDate", rVbDate); //2024-07-01
                fileDateCompWithURL = new Date(rVbDate.split("-")[2], rVbDate.split("-")[1] - 1, rVbDate.split("-")[0]); // formatFileDate(rVbDate);
                log.debug("fileDateCompWithURL", fileDateCompWithURL);
				var obj = {}
                if (PublisherURL && fileDateCompWithURL && pubProgBrandURLFullDate) 
				{
                    if ((Beyond == "T" || Beyond == true) && (fileDateCompWithURL.getTime() >= pubProgBrandURLFullDate.getTime()) && fileDateCompWithURL && pubProgBrandURLFullDate) {
                        obj.siteURL = PublisherURL;
                    }
                }
				
				if (siteID && fileDateCompWithURL && pubProgBrandURLFullDate) {
                    if ((Beyond == "T" || Beyond == true) && (fileDateCompWithURL.getTime() >= pubProgBrandURLFullDate.getTime()) && fileDateCompWithURL && pubProgBrandURLFullDate) {
                        obj.siteId = siteID;
                    }
                }
				if(Object.keys(obj).length >0)
				{
					BrandUrlConsider.push(obj)
				}
                return true;
            });
            return BrandUrlConsider;
        }
        //End of the code deriving URLs where Beyond Flag is Checked.

        function _logValidation(value) {
            if (value != 'null' && value != null && value != null && value != '' && value != undefined && value != ' ' && value != 'undefined' && value != 'NaN' && value != NaN) {
                return true;
            } else {
                return false;
            }
        }

        return {
            getInputData: getInputData,
            map: map,
            reduce: reduce,
            summarize: summarize
        };
    });