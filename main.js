$(document).ready(function() {

        

        var numOfTeams = $('#numberOfTeams').val();
        var weightBox = '';
        for(var i=1;i<=numOfTeams; i++){
          /*if($('input[type=checkbox]').attr('checked'))
            weightBox = "<input type=\"number\" class=\"form-control classWeight\" id=\"teamWeight"+i+"\" value=1>"*/

          $('#teamNames').append("<span class=\"  col-lg-6 col-sm-12 team-input\"><label>"+i+".</label><input type=\"text\" autocomplete=\"on\" class=\"form-control save\" onclick=\"this.setSelectionRange(0, this.value.length)\" id=\"team"+i+"\" value=\"Team "+i+" \"><input  type=\"number\" onclick=\"this.select()\" pattern=\"[0-9]*\" min=\"0\" class=\"classWeight form-control save\" id=\"teamWeight"+i+"\" value=1></span>");
        }

        //Team Number Change
        $('#numberOfTeams').change(function() {
          var newNumOfTeams = $('#numberOfTeams').val();
          var diffOfTeams = newNumOfTeams - numOfTeams;

          if(diffOfTeams > 0)
          {  
            var newLoopNum = Number(numOfTeams)+1;
            for(var i=newLoopNum;i<=newNumOfTeams; i++)
            {
              $('#teamNames').append("<span class=\"  col-md-6 col-sm-12 team-input\"><label>"+i+".</label><input type=\"text\" autocomplete=\"on\" class=\"form-control save\" onclick=\"this.setSelectionRange(0, this.value.length)\" id=\"team"+i+"\" value=\"Team "+i+" \"><input type=\"number\" onclick=\"this.select()\" pattern=\"[0-9]*\" min=\"0\" type=\"number\" class=\"form-control classWeight save\" id=\"teamWeight"+i+"\" value=1></span>");
            }
            hideWeights();
            numOfTeams = newNumOfTeams;
          }
          else if(diffOfTeams < 0)
          {
            var newLoopNum = Number(diffOfTeams)*-1;
            for(var i=0;i<newLoopNum;i++)
              $('#teamNames').children().last().remove();

            numOfTeams = newNumOfTeams;
          }
        });
        //Initial hiding of weights
        hideWeights();

        $('input[type="checkbox"]').click(function(){
          $('.classWeight').toggle();
        });

        var teamNames = [];


        //SUBMIT BUTTON CLIK
        $('#submit').click(function() {

          teamNames = [];
          teamWeights = [];

          for(var i=1; i<=numOfTeams; i++)
            teamNames.push($('#team'+i).val());

          if($('input[type="checkbox"]').is(":checked") == true) {
            for(var i=1; i<=numOfTeams; i++)
              teamWeights.push($('#teamWeight'+i).val());
            //alert(teamWeights[1]);

            teamNames = weightedShuffle(teamNames, teamWeights);
          }
          else 
            teamNames = shuffle(teamNames);
          
          localStorage.setItem('arrayResults', JSON.stringify(teamNames));
          localStorage.setItem('leagueName', JSON.stringify($('#league_name').val()));
          window.location.href='draftResults.html';
        });

        //DRAFT NIGHT '26 CLICK — stash the form, head to the broadcast page
        $('#premiumReveal').click(function() {
          var weighted = $('input[type="checkbox"]').is(":checked");
          var teams = [];

          for(var i=1; i<=numOfTeams; i++) {
            teams.push({
              name: ($('#team'+i).val() || '').trim(),
              weight: weighted ? Number($('#teamWeight'+i).val()) : 1
            });
          }

          var league = ($('#league_name').val() || '').trim();
          var complete = league && teams.length >= 2 && teams.every(function(t){ return t.name; });

          if (complete) {
            localStorage.setItem('fdl_dn_league', JSON.stringify({
              leagueName: league,
              teams: teams,
              weighted: weighted
            }));
          }
          window.location.href = 'draft-night.html';
        });


/*****FUNCTIONS *****/


        //OFFICIAL RANDOM FUNCTION
        function shuffle(array) {
          var currentIndex = array.length, temporaryValue, randomIndex;

          // While there remain elements to shuffle...
            while (0 !== currentIndex) {

              // Pick a remaining element...
              randomIndex = Math.floor(Math.random() * currentIndex);
              currentIndex -= 1;

              // And swap it with the current element.
              temporaryValue = array[currentIndex];
              array[currentIndex] = array[randomIndex];
              array[randomIndex] = temporaryValue;
            }

          return array;
        }

        function weightedShuffle(array, weight) {

          var weightedList = [];
          var finishedList = [];

          for (var i = 0; i < weight.length; i++) {
            var multiples = weight[i];
         
          // Loop over the list of items
            for (var j = 0; j < multiples; j++) {
              weightedList.push(array[i]);
            }
          }

          weightedList = shuffle(weightedList);
          var random_num = 0

          while(weightedList.length !== 0) {
            random_num = rand(0, weightedList.length-1);
            finishedList.push(weightedList[random_num]);
            weightedList = removeElement(weightedList, weightedList[random_num]);

          }

          return finishedList;

        }

        function rand(min, max) {
            return Math.floor(Math.random() * (max - min + 1)) + min;
        };

        function removeElement(array, element) {
          var len = array.length
          for(var i = 0; i < len; i++){ 
            if ( array[i] === element && i < array.length) {
              array.splice(i, 1); 
              i=-1;
            }
          }

          return array;

        };

        function hideWeights(){
          if($('input[type="checkbox"]').is(":checked") == false) {
            $('.classWeight').hide();
          }
        }

        function getHead(){
            $("#header").load("../header.html");
        };



/*
$(document).on("change", ".save", e => {
  if (!e.target.id) return;
  localStorage.setItem(e.target.id, $(e.target).val());
});

$(() => $(".save").each(function() {
  if (!this.id) return;
  let val = localStorage.getItem(this.id);
  if (val) $(this).val(val);
}));*/

      });